const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { writeAuditLog } = require("../utils/audit");
const {
  encryptPii,
  maskAadhaar,
  maskPan,
  maskEmail,
  maskMobile,
} = require("../utils/security");
const {
  SEBI_NOMINEE_RELATIONSHIPS,
  isValidEmail,
  isValidPhone,
  normalizeMobile,
  normalizePan,
  normalizeAadhaar,
  isValidPan,
  isValidAadhaar,
  sanitizeText,
  parseDob,
  getAgeYears,
  normalizeRelationship,
} = require("../utils/validators");
const {
  sendEmailOtp,
  verifyEmailOtp,
  assertRecentVerifiedEmailOtp,
} = require("./emailOtpService");
const { ensureWallet } = require("./walletService");
const { sendWelcomeEmail, sendKycReminderEmail } = require("./emailService");

function AppError(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.extra = extra;
  return err;
}

function pickUploadedFile(files, aliases) {
  if (!Array.isArray(files) || !files.length) return null;
  const wanted = aliases.map((a) => String(a).toLowerCase());
  const match = files.find((f) => wanted.includes(String(f.fieldname || "").toLowerCase()));
  return match?.filename || null;
}

function buildPendingKycPayload() {
  return {
    submitted: false,
    message: "KYC not submitted",
    status: "pending",
  };
}

/**
 * Same payload as POST /api/auth/register (including email OTP).
 * Admin token is used for auth; created user is stored and returned for KYC/nominee steps.
 */
async function createUserByAdmin(body, adminCtx = {}) {
  const fullName = String(body.full_name || body.fullName || "").trim();
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const phone = normalizeMobile(body.phone || body.phone_number || body.phoneNumber);
  const dobParsed = parseDob(body.dob || body.date_of_birth || body.dateOfBirth);
  const password = String(body.password || "");
  const confirmPassword = String(body.confirm_password || body.confirmPassword || "");
  const otp = String(body.otp || "").trim();

  if (!fullName || !email || !password || !confirmPassword || !phone || !dobParsed) {
    throw AppError(
      "Full name, email, password, confirm password, phone number and date of birth are required",
      400,
      { errorCode: "VALIDATION_ERROR" }
    );
  }
  if (!isValidEmail(email)) {
    throw AppError("Invalid email address", 400, { errorCode: "INVALID_EMAIL" });
  }
  if (!isValidPhone(phone)) {
    throw AppError("Phone number must be a valid 10-digit Indian mobile number", 400, {
      errorCode: "INVALID_PHONE",
    });
  }
  if (password.length < 6) {
    throw AppError("Password must be at least 6 characters", 400, {
      errorCode: "VALIDATION_ERROR",
    });
  }
  if (password !== confirmPassword) {
    throw AppError("Password and confirm password do not match", 400, {
      errorCode: "VALIDATION_ERROR",
    });
  }

  const [existing] = await pool.query(
    `SELECT id FROM users WHERE email = :email OR phone = :phone LIMIT 1`,
    { email, phone }
  );
  if (existing.length) {
    throw AppError("Email or phone number already registered", 409, {
      errorCode: "ALREADY_REGISTERED",
    });
  }

  try {
    if (otp) {
      await verifyEmailOtp({
        email,
        otp,
        purpose: "EMAIL_VERIFICATION",
        markEmailVerified: false,
      });
    } else {
      await assertRecentVerifiedEmailOtp(email, "EMAIL_VERIFICATION", 30);
    }
  } catch (otpError) {
    throw otpError;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, date_of_birth, role, email_verified_at)
     VALUES (:fullName, :email, :passwordHash, :phone, :dateOfBirth, 'user', NOW())`,
    {
      fullName,
      email,
      passwordHash,
      phone,
      dateOfBirth: dobParsed.iso,
    }
  );

  const userId = result.insertId;

  try {
    await ensureWallet(userId);
  } catch (walletErr) {
    console.error("[ADMIN] wallet create on user create:", walletErr.message);
  }

  await writeAuditLog({
    userId: adminCtx.adminId || null,
    action: "ADMIN_CREATE_USER",
    entityType: "user",
    entityId: userId,
    ipAddress: adminCtx.ipAddress,
    userAgent: adminCtx.userAgent,
    meta: { email, phone },
  });

  try {
    await sendWelcomeEmail({
      to: email,
      firstName: fullName.split(/\s+/)[0] || fullName,
      email,
      registeredAt: new Date(),
    });
  } catch (mailErr) {
    console.error("[ADMIN] welcome email failed:", mailErr.code || mailErr.message);
  }

  try {
    await sendKycReminderEmail({
      to: email,
      firstName: fullName.split(/\s+/)[0] || null,
    });
  } catch (mailErr) {
    console.error("[ADMIN] KYC reminder email failed:", mailErr.code || mailErr.message);
  }

  return {
    user: {
      id: userId,
      full_name: fullName,
      email,
      phone,
      date_of_birth: dobParsed.iso,
      role: "user",
      email_verified: true,
      kyc_status: "pending",
    },
    kyc: buildPendingKycPayload(),
    nominee: { added: false, message: "Nominee not added" },
    next_step: "kyc",
  };
}

/**
 * Same as POST /api/auth/send-email-otp for register (EMAIL_VERIFICATION).
 */
async function sendRegisterEmailOtpByAdmin(body, adminCtx = {}) {
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const firstName = body.first_name || body.firstName || null;
  const purpose = body.purpose || "EMAIL_VERIFICATION";

  if (!email || !isValidEmail(email)) {
    throw AppError("Valid email is required", 400, { errorCode: "INVALID_EMAIL" });
  }

  const data = await sendEmailOtp({
    email,
    purpose,
    firstName,
    ipAddress: adminCtx.ipAddress,
    requireExistingUser: false,
    requireMissingUser: true,
  });

  await writeAuditLog({
    userId: adminCtx.adminId || null,
    action: "ADMIN_SEND_USER_EMAIL_OTP",
    entityType: "user",
    ipAddress: adminCtx.ipAddress,
    userAgent: adminCtx.userAgent,
    meta: { email, purpose: data?.purpose || purpose },
  });

  return data;
}

async function assertUserExists(userId) {
  const id = Number(userId);
  if (!id) throw AppError("Valid user id is required", 400);
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, kyc_status, kyc_method, role
     FROM users WHERE id = :id AND role = 'user' LIMIT 1`,
    { id }
  );
  if (!rows.length) throw AppError("User not found", 404);
  return rows[0];
}

/**
 * Admin submits / updates KYC for a user (manual by default).
 * Optional auto_approve=true marks KYC verified immediately.
 */
async function upsertKycByAdmin(userId, body, files, adminCtx = {}) {
  const user = await assertUserExists(userId);

  const panNumber = normalizePan(body.pan_number || body.panNumber);
  const panFullName = String(
    body.pan_full_name ||
      body.panFullName ||
      body.full_name ||
      body.fullName ||
      user.full_name ||
      ""
  ).trim();
  const aadhaarNumber = normalizeAadhaar(
    body.aadhaar_number ||
      body.aadhaarNumber ||
      body.aadhaara_number ||
      body.aadhaaraNumber ||
      body.aadhar_number ||
      body.aadharNumber
  );
  const methodRaw = String(body.method || body.kyc_method || "manual")
    .trim()
    .toLowerCase();
  const method = methodRaw === "digilocker" ? "digilocker" : "manual";
  const digilockerRef =
    String(body.digilocker_ref || body.digilockerRef || "").trim() || null;

  const panImage =
    pickUploadedFile(files, ["pan_image", "panImage", "pan_photo", "panPhoto", "pan"]) ||
    String(body.pan_image || "").trim() ||
    null;
  const aadhaarImage =
    pickUploadedFile(files, [
      "aadhaar_image",
      "aadhaarImage",
      "aadhaara_image",
      "aadhaaraImage",
      "aadhar_image",
      "aadharImage",
      "aadhaar_photo",
      "aadhaarPhoto",
      "aadhaar",
      "aadhar",
      "aadhaara",
    ]) ||
    String(body.aadhaar_image || body.aadhaara_image || "").trim() ||
    null;

  if (!panNumber || !isValidPan(panNumber)) {
    throw AppError("Valid PAN card number is required");
  }
  if (!panFullName) throw AppError("Full name from PAN is required");
  if (!aadhaarNumber || !isValidAadhaar(aadhaarNumber)) {
    throw AppError("Valid 12-digit Aadhaar number is required");
  }
  if (!panImage || !aadhaarImage) {
    throw AppError("PAN card photo and Aadhaar card photo are required", 400, {
      hint: "Send form-data files as pan_image and aadhaar_image",
      received_file_fields: Array.isArray(files) ? files.map((f) => f.fieldname) : [],
    });
  }

  const autoApprove = ["1", "true", "yes", "approved", "verified"].includes(
    String(body.auto_approve || body.autoApprove || body.status || "")
      .trim()
      .toLowerCase()
  );
  const kycStatus = autoApprove ? "verified" : "submitted";

  await pool.query(
    `INSERT INTO kyc_documents
      (user_id, method, pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image, digilocker_ref, status)
     VALUES
      (:userId, :method, :panNumber, :panFullName, :panImage, :aadhaarNumber, :aadhaarImage, :digilockerRef, :kycStatus)
     ON DUPLICATE KEY UPDATE
      method = VALUES(method),
      pan_number = VALUES(pan_number),
      pan_full_name = VALUES(pan_full_name),
      pan_image = VALUES(pan_image),
      aadhaar_number = VALUES(aadhaar_number),
      aadhaar_image = VALUES(aadhaar_image),
      digilocker_ref = VALUES(digilocker_ref),
      status = VALUES(status)`,
    {
      userId: user.id,
      method,
      panNumber,
      panFullName,
      panImage,
      aadhaarNumber,
      aadhaarImage,
      digilockerRef,
      kycStatus,
    }
  );

  await pool.query(
    `UPDATE users SET kyc_status = :kycStatus, kyc_method = :method WHERE id = :userId`,
    { userId: user.id, kycStatus, method }
  );

  await writeAuditLog({
    userId: adminCtx.adminId || null,
    action: autoApprove ? "ADMIN_UPSERT_USER_KYC_VERIFIED" : "ADMIN_UPSERT_USER_KYC",
    entityType: "user",
    entityId: user.id,
    ipAddress: adminCtx.ipAddress,
    userAgent: adminCtx.userAgent,
    meta: {
      method,
      kyc_status: kycStatus,
      pan_masked: maskPan(panNumber),
      aadhaar_masked: maskAadhaar(aadhaarNumber),
    },
  });

  if (!autoApprove) {
    try {
      const { sendKycSubmittedEmail } = require("./emailService");
      if (user.email) {
        await sendKycSubmittedEmail({
          to: user.email,
          firstName: String(user.full_name || "").split(/\s+/)[0] || null,
        });
      }
    } catch (mailErr) {
      console.error("[ADMIN] KYC submitted email failed:", mailErr.code || mailErr.message);
    }
  } else {
    try {
      const { sendKycVerifiedEmail } = require("./emailService");
      if (user.email) {
        await sendKycVerifiedEmail({
          to: user.email,
          firstName: String(user.full_name || "").split(/\s+/)[0] || null,
        });
      }
    } catch (mailErr) {
      console.error("[ADMIN] KYC verified email failed:", mailErr.code || mailErr.message);
    }
  }

  return {
    user_id: user.id,
    method,
    pan_number: panNumber,
    pan_full_name: panFullName,
    aadhaar_number: aadhaarNumber,
    pan_image: panImage,
    aadhaar_image: aadhaarImage,
    digilocker_ref: digilockerRef,
    kyc_status: kycStatus,
    status: kycStatus === "verified" ? "approved" : kycStatus,
    submitted: true,
    nominee: {
      added: false,
      message: "Nominee not added",
    },
    next_step: "nominee",
  };
}

/**
 * Admin adds / updates nominee for a user (requires KYC documents).
 */
async function upsertNomineeByAdmin(userId, body, files, adminCtx = {}) {
  const user = await assertUserExists(userId);

  const nomineeName = sanitizeText(body.nominee_name || body.nomineeName, 150);
  const relationship = normalizeRelationship(body.relationship);
  const dobParsed = parseDob(body.dob || body.date_of_birth || body.dateOfBirth);
  const mobile = normalizeMobile(body.mobile || body.phone || body.phone_number);
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const address = sanitizeText(body.address, 500);
  const panNumber = normalizePan(body.pan_number || body.panNumber);
  const aadhaarNumber = normalizeAadhaar(
    body.aadhaar_number ||
      body.aadhaarNumber ||
      body.aadhaara_number ||
      body.aadhaaraNumber ||
      body.aadhar_number
  );

  const panImage =
    pickUploadedFile(files, ["pan_image", "panImage", "nominee_pan", "nomineePan"]) ||
    String(body.pan_image || "").trim() ||
    null;
  const aadhaarImage =
    pickUploadedFile(files, [
      "aadhaar_image",
      "aadhaarImage",
      "aadhaara_image",
      "aadhaaraImage",
      "aadhar_image",
      "nominee_aadhaar",
      "nomineeAadhaar",
    ]) ||
    String(body.aadhaar_image || "").trim() ||
    null;

  const allocationPercent = Number(body.allocation_percent || body.allocationPercent || 100);
  const guardianName = sanitizeText(body.guardian_name || body.guardianName, 150) || null;
  const guardianRelationship =
    normalizeRelationship(body.guardian_relationship || body.guardianRelationship) ||
    sanitizeText(body.guardian_relationship || body.guardianRelationship, 100) ||
    null;

  if (
    !nomineeName ||
    !relationship ||
    !dobParsed ||
    !mobile ||
    !email ||
    !address ||
    !panNumber ||
    !aadhaarNumber
  ) {
    throw AppError(
      "Nominee name, relationship, dob, mobile, email, address, pan_number and aadhaar_number are required",
      400,
      { allowed_relationships: SEBI_NOMINEE_RELATIONSHIPS }
    );
  }
  if (!isValidPhone(mobile)) {
    throw AppError("Nominee mobile must be a valid 10-digit Indian mobile number");
  }
  if (!isValidEmail(email)) throw AppError("Valid nominee email is required");
  if (!isValidPan(panNumber)) throw AppError("Valid nominee PAN is required");
  if (!isValidAadhaar(aadhaarNumber)) {
    throw AppError("Valid 12-digit nominee Aadhaar number is required");
  }
  if (!panImage || !aadhaarImage) {
    throw AppError("Nominee PAN image and Aadhaar image are required (SEBI KYC document proof)", 400, {
      received_file_fields: Array.isArray(files) ? files.map((f) => f.fieldname) : [],
    });
  }
  if (Number.isNaN(allocationPercent) || allocationPercent <= 0 || allocationPercent > 100) {
    throw AppError("allocation_percent must be between 0.01 and 100");
  }

  const age = getAgeYears(dobParsed.date);
  const isMinor = age < 18;
  if (isMinor && (!guardianName || !guardianRelationship)) {
    throw AppError(
      "Nominee is a minor. SEBI rules require guardian_name and guardian_relationship for FD/RD/MF nominee"
    );
  }
  if (age > 120) throw AppError("Invalid nominee date of birth");

  const [kycRows] = await pool.query(
    `SELECT id, pan_number, aadhaar_number FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
    { userId: user.id }
  );
  if (!kycRows.length) {
    throw AppError("Complete KYC for this user before adding nominee details", 400);
  }

  const investorPan = String(kycRows[0].pan_number || "").toUpperCase();
  const investorAadhaar = String(kycRows[0].aadhaar_number || "");
  if (investorPan === panNumber || investorAadhaar === aadhaarNumber) {
    throw AppError("Nominee PAN/Aadhaar cannot be the same as the investor (SEBI compliance)");
  }

  const encryptedPan = encryptPii(panNumber);
  const encryptedAadhaar = encryptPii(aadhaarNumber);

  await pool.query(
    `INSERT INTO nominees
      (user_id, nominee_name, relationship, date_of_birth, mobile, email, address,
       pan_number, aadhaar_number, pan_image, aadhaar_image, allocation_percent,
       is_minor, guardian_name, guardian_relationship, status)
     VALUES
      (:userId, :nomineeName, :relationship, :dateOfBirth, :mobile, :email, :address,
       :panNumber, :aadhaarNumber, :panImage, :aadhaarImage, :allocationPercent,
       :isMinor, :guardianName, :guardianRelationship, 'active')
     ON DUPLICATE KEY UPDATE
      nominee_name = VALUES(nominee_name),
      relationship = VALUES(relationship),
      date_of_birth = VALUES(date_of_birth),
      mobile = VALUES(mobile),
      email = VALUES(email),
      address = VALUES(address),
      pan_number = VALUES(pan_number),
      aadhaar_number = VALUES(aadhaar_number),
      pan_image = VALUES(pan_image),
      aadhaar_image = VALUES(aadhaar_image),
      allocation_percent = VALUES(allocation_percent),
      is_minor = VALUES(is_minor),
      guardian_name = VALUES(guardian_name),
      guardian_relationship = VALUES(guardian_relationship),
      status = 'active'`,
    {
      userId: user.id,
      nomineeName,
      relationship,
      dateOfBirth: dobParsed.iso,
      mobile,
      email,
      address,
      panNumber: encryptedPan,
      aadhaarNumber: encryptedAadhaar,
      panImage,
      aadhaarImage,
      allocationPercent,
      isMinor: isMinor ? 1 : 0,
      guardianName: isMinor ? guardianName : null,
      guardianRelationship: isMinor ? guardianRelationship : null,
    }
  );

  await writeAuditLog({
    userId: adminCtx.adminId || null,
    action: "ADMIN_UPSERT_NOMINEE",
    entityType: "nominee",
    entityId: user.id,
    ipAddress: adminCtx.ipAddress,
    userAgent: adminCtx.userAgent,
    meta: {
      target_user_id: user.id,
      relationship,
      is_minor: isMinor,
      allocation_percent: allocationPercent,
      pan_masked: maskPan(panNumber),
      aadhaar_masked: maskAadhaar(aadhaarNumber),
    },
  });

  return {
    user_id: user.id,
    nominee_name: nomineeName,
    relationship,
    dob: dobParsed.iso,
    date_of_birth: dobParsed.iso,
    mobile: maskMobile(mobile),
    email: maskEmail(email),
    address,
    pan_number: maskPan(panNumber),
    aadhaar_number: maskAadhaar(aadhaarNumber),
    pan_image: panImage,
    aadhaar_image: aadhaarImage,
    allocation_percent: allocationPercent,
    is_minor: isMinor,
    guardian_name: isMinor ? guardianName : null,
    guardian_relationship: isMinor ? guardianRelationship : null,
    nominee: {
      added: true,
      message: "Nominee added",
    },
    next_step: "profile",
  };
}

module.exports = {
  createUserByAdmin,
  sendRegisterEmailOtpByAdmin,
  upsertKycByAdmin,
  upsertNomineeByAdmin,
};
