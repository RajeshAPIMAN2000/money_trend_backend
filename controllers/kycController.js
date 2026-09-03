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
  normalizePan,
  normalizeAadhaar,
  isValidPan,
  isValidAadhaar,
  sanitizeText,
  parseDob,
  getAgeYears,
  normalizeRelationship,
} = require("../utils/validators");

function pickUploadedFile(files, aliases) {
  if (!Array.isArray(files) || !files.length) return null;
  const wanted = aliases.map((a) => String(a).toLowerCase());
  const match = files.find((f) => wanted.includes(String(f.fieldname || "").toLowerCase()));
  return match?.filename || null;
}

/**
 * Manual KYC lookup stub: after PAN is entered, return the registered full name
 * (in production this can call a PAN verification API).
 */
async function lookupPan(req, res) {
  console.log("[KYC] pan-lookup body:", req.body);
  try {
    const panNumber = normalizePan(req.body.pan_number || req.body.panNumber || req.query.pan);
    if (!panNumber || !isValidPan(panNumber)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid PAN card number (e.g. ABCDE1234F)",
      });
    }

    const [rows] = await pool.query(`SELECT full_name FROM users WHERE id = :userId LIMIT 1`, {
      userId: req.user.id,
    });

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      message: "PAN details fetched",
      data: {
        pan_number: panNumber,
        full_name: rows[0].full_name,
      },
    });
  } catch (error) {
    console.error("[KYC] pan-lookup error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to lookup PAN",
      error: error.message,
    });
  }
}

async function submitManualKyc(req, res) {
  console.log("[KYC] manual body:", req.body);
  console.log(
    "[KYC] manual files:",
    Array.isArray(req.files)
      ? req.files.map((f) => ({ fieldname: f.fieldname, filename: f.filename, mimetype: f.mimetype }))
      : req.files
  );

  try {
    const panNumber = normalizePan(req.body.pan_number || req.body.panNumber);
    const panFullName = String(
      req.body.pan_full_name ||
        req.body.panFullName ||
        req.body.full_name ||
        req.body.fullName ||
        ""
    ).trim();
    const aadhaarNumber = normalizeAadhaar(
      req.body.aadhaar_number ||
        req.body.aadhaarNumber ||
        req.body.aadhaara_number ||
        req.body.aadhaaraNumber ||
        req.body.aadhar_number ||
        req.body.aadharNumber
    );

    const panImage = pickUploadedFile(req.files, [
      "pan_image",
      "panImage",
      "pan_photo",
      "panPhoto",
      "pan",
    ]);
    const aadhaarImage = pickUploadedFile(req.files, [
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
    ]);

    if (!panNumber || !isValidPan(panNumber)) {
      return res.status(400).json({ success: false, message: "Valid PAN card number is required" });
    }
    if (!panFullName) {
      return res.status(400).json({ success: false, message: "Full name from PAN is required" });
    }
    if (!aadhaarNumber || !isValidAadhaar(aadhaarNumber)) {
      return res.status(400).json({ success: false, message: "Valid 12-digit Aadhaar number is required" });
    }
    if (!panImage || !aadhaarImage) {
      return res.status(400).json({
        success: false,
        message: "PAN card photo and Aadhaar card photo are required",
        hint: "Send form-data files as pan_image and aadhaar_image",
        received_file_fields: Array.isArray(req.files) ? req.files.map((f) => f.fieldname) : [],
      });
    }

    const userId = req.user.id;

    await pool.query(
      `INSERT INTO kyc_documents
        (user_id, method, pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image, status)
       VALUES
        (:userId, 'manual', :panNumber, :panFullName, :panImage, :aadhaarNumber, :aadhaarImage, 'submitted')
       ON DUPLICATE KEY UPDATE
        method = 'manual',
        pan_number = VALUES(pan_number),
        pan_full_name = VALUES(pan_full_name),
        pan_image = VALUES(pan_image),
        aadhaar_number = VALUES(aadhaar_number),
        aadhaar_image = VALUES(aadhaar_image),
        status = 'submitted'`,
      { userId, panNumber, panFullName, panImage, aadhaarNumber, aadhaarImage }
    );

    await pool.query(
      `UPDATE users SET kyc_status = 'submitted', kyc_method = 'manual' WHERE id = :userId`,
      { userId }
    );

    return res.status(201).json({
      success: true,
      message: "Manual KYC submitted successfully. Please enter nominee details.",
      data: {
        method: "manual",
        pan_number: panNumber,
        pan_full_name: panFullName,
        aadhaar_number: aadhaarNumber,
        pan_image: panImage,
        aadhaar_image: aadhaarImage,
        nominee: {
          added: false,
          message: "Nominee not added",
        },
        next_step: "nominee",
      },
    });
  } catch (error) {
    console.error("[KYC] manual error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit KYC",
      error: error.message,
    });
  }
}

/**
 * DigiLocker KYC flow placeholder.
 * Wire DigiLocker OAuth + document fetch credentials here when available.
 */
async function submitDigilockerKyc(req, res) {
  console.log("[KYC] digilocker body:", req.body);
  console.log(
    "[KYC] digilocker files:",
    Array.isArray(req.files)
      ? req.files.map((f) => ({ fieldname: f.fieldname, filename: f.filename, mimetype: f.mimetype }))
      : req.files
  );

  try {
    const panNumber = normalizePan(req.body.pan_number || req.body.panNumber);
    const panFullName = String(
      req.body.pan_full_name || req.body.panFullName || req.body.full_name || req.body.fullName || ""
    ).trim();
    const aadhaarNumber = normalizeAadhaar(
      req.body.aadhaar_number ||
        req.body.aadhaarNumber ||
        req.body.aadhaara_number ||
        req.body.aadhaaraNumber ||
        req.body.aadhar_number ||
        req.body.aadharNumber
    );
    const digilockerRef = String(req.body.digilocker_ref || req.body.digilockerRef || "").trim() || null;

    const panImage =
      pickUploadedFile(req.files, ["pan_image", "panImage", "pan_photo", "panPhoto", "pan"]) ||
      req.body.pan_image ||
      null;
    const aadhaarImage =
      pickUploadedFile(req.files, [
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
      req.body.aadhaar_image ||
      req.body.aadhaara_image ||
      null;

    if (!panNumber || !isValidPan(panNumber)) {
      return res.status(400).json({ success: false, message: "Valid PAN card number is required" });
    }
    if (!panFullName) {
      return res.status(400).json({ success: false, message: "Full name is required" });
    }
    if (!aadhaarNumber || !isValidAadhaar(aadhaarNumber)) {
      return res.status(400).json({ success: false, message: "Valid 12-digit Aadhaar number is required" });
    }

    const userId = req.user.id;

    await pool.query(
      `INSERT INTO kyc_documents
        (user_id, method, pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image, digilocker_ref, status)
       VALUES
        (:userId, 'digilocker', :panNumber, :panFullName, :panImage, :aadhaarNumber, :aadhaarImage, :digilockerRef, 'submitted')
       ON DUPLICATE KEY UPDATE
        method = 'digilocker',
        pan_number = VALUES(pan_number),
        pan_full_name = VALUES(pan_full_name),
        pan_image = VALUES(pan_image),
        aadhaar_number = VALUES(aadhaar_number),
        aadhaar_image = VALUES(aadhaar_image),
        digilocker_ref = VALUES(digilocker_ref),
        status = 'submitted'`,
      {
        userId,
        panNumber,
        panFullName,
        panImage,
        aadhaarNumber,
        aadhaarImage,
        digilockerRef,
      }
    );

    await pool.query(
      `UPDATE users SET kyc_status = 'submitted', kyc_method = 'digilocker' WHERE id = :userId`,
      { userId }
    );

    return res.status(201).json({
      success: true,
      message: "DigiLocker KYC submitted successfully. Please enter nominee details.",
      data: {
        method: "digilocker",
        pan_number: panNumber,
        pan_full_name: panFullName,
        aadhaar_number: aadhaarNumber,
        digilocker_ref: digilockerRef,
        nominee: {
          added: false,
          message: "Nominee not added",
        },
        next_step: "nominee",
      },
    });
  } catch (error) {
    console.error("[KYC] digilocker error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit DigiLocker KYC",
      error: error.message,
    });
  }
}

async function submitNominee(req, res) {
  console.log("[KYC] nominee body:", req.body);
  console.log(
    "[KYC] nominee files:",
    Array.isArray(req.files)
      ? req.files.map((f) => ({ fieldname: f.fieldname, filename: f.filename, mimetype: f.mimetype }))
      : req.files
  );

  try {
    const nomineeName = sanitizeText(req.body.nominee_name || req.body.nomineeName, 150);
    const relationship = normalizeRelationship(req.body.relationship);
    const dobParsed = parseDob(req.body.dob || req.body.date_of_birth || req.body.dateOfBirth);
    const mobile = String(req.body.mobile || req.body.phone || req.body.phone_number || "")
      .replace(/\s+/g, "")
      .trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const address = sanitizeText(req.body.address, 500);
    const panNumber = normalizePan(req.body.pan_number || req.body.panNumber);
    const aadhaarNumber = normalizeAadhaar(
      req.body.aadhaar_number ||
        req.body.aadhaarNumber ||
        req.body.aadhaara_number ||
        req.body.aadhaaraNumber ||
        req.body.aadhar_number
    );

    const panImage = pickUploadedFile(req.files, [
      "pan_image",
      "panImage",
      "nominee_pan",
      "nomineePan",
    ]);
    const aadhaarImage = pickUploadedFile(req.files, [
      "aadhaar_image",
      "aadhaarImage",
      "aadhaara_image",
      "aadhaaraImage",
      "aadhar_image",
      "nominee_aadhaar",
      "nomineeAadhaar",
    ]);

    const allocationPercent = Number(
      req.body.allocation_percent || req.body.allocationPercent || 100
    );
    const guardianName = sanitizeText(req.body.guardian_name || req.body.guardianName, 150) || null;
    const guardianRelationship =
      normalizeRelationship(req.body.guardian_relationship || req.body.guardianRelationship) ||
      sanitizeText(req.body.guardian_relationship || req.body.guardianRelationship, 100) ||
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
      return res.status(400).json({
        success: false,
        message:
          "Nominee name, relationship, dob, mobile, email, address, pan_number and aadhaar_number are required",
        allowed_relationships: SEBI_NOMINEE_RELATIONSHIPS,
      });
    }

    if (!isValidPhone(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Nominee mobile must be a valid 10-digit Indian mobile number",
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid nominee email is required" });
    }
    if (!isValidPan(panNumber)) {
      return res.status(400).json({ success: false, message: "Valid nominee PAN is required" });
    }
    if (!isValidAadhaar(aadhaarNumber)) {
      return res.status(400).json({
        success: false,
        message: "Valid 12-digit nominee Aadhaar number is required",
      });
    }
    if (!panImage || !aadhaarImage) {
      return res.status(400).json({
        success: false,
        message: "Nominee PAN image and Aadhaar image are required (SEBI KYC document proof)",
        received_file_fields: Array.isArray(req.files) ? req.files.map((f) => f.fieldname) : [],
      });
    }
    if (Number.isNaN(allocationPercent) || allocationPercent <= 0 || allocationPercent > 100) {
      return res.status(400).json({
        success: false,
        message: "allocation_percent must be between 0.01 and 100",
      });
    }

    const age = getAgeYears(dobParsed.date);
    const isMinor = age < 18;
    if (isMinor && (!guardianName || !guardianRelationship)) {
      return res.status(400).json({
        success: false,
        message:
          "Nominee is a minor. SEBI rules require guardian_name and guardian_relationship for FD/RD/MF nominee",
      });
    }
    if (age > 120) {
      return res.status(400).json({ success: false, message: "Invalid nominee date of birth" });
    }

    const userId = req.user.id;

    const [kycRows] = await pool.query(
      `SELECT id, pan_number, aadhaar_number FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
      { userId }
    );
    if (!kycRows.length) {
      return res.status(400).json({
        success: false,
        message: "Complete KYC (manual or DigiLocker) before adding nominee details",
      });
    }

    // Investor cannot nominate themselves with same PAN/Aadhaar
    const investorPan = String(kycRows[0].pan_number || "").toUpperCase();
    const investorAadhaar = String(kycRows[0].aadhaar_number || "");
    if (investorPan === panNumber || investorAadhaar === aadhaarNumber) {
      return res.status(400).json({
        success: false,
        message: "Nominee PAN/Aadhaar cannot be the same as the investor (SEBI compliance)",
      });
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
        userId,
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
      userId,
      action: "NOMINEE_UPSERT",
      entityType: "nominee",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: {
        relationship,
        is_minor: isMinor,
        allocation_percent: allocationPercent,
        aadhaar_masked: maskAadhaar(aadhaarNumber),
        pan_masked: maskPan(panNumber),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Nominee details saved successfully (SEBI-compliant)",
      data: {
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
      },
    });
  } catch (error) {
    console.error("[KYC] nominee error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save nominee details",
      error: error.message,
    });
  }
}

module.exports = {
  lookupPan,
  submitManualKyc,
  submitDigilockerKyc,
  submitNominee,
};
