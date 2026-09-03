const pool = require("../config/db");
const {
  decryptPii,
  encryptPii,
  maskAadhaar,
  maskPan,
  maskEmail,
  maskMobile,
} = require("../utils/security");
const {
  isValidEmail,
  isValidPhone,
  sanitizeText,
  parseDob,
  normalizeRelationship,
  SEBI_NOMINEE_RELATIONSHIPS,
  normalizePan,
  normalizeAadhaar,
  isValidPan,
  isValidAadhaar,
  getAgeYears,
} = require("../utils/validators");
const { writeAuditLog } = require("../utils/audit");

function formatNomineeForResponse(row) {
  if (!row) return null;
  const pan = decryptPii(row.pan_number) || row.pan_number;
  const aadhaar = decryptPii(row.aadhaar_number) || row.aadhaar_number;

  return {
    nominee_name: row.nominee_name,
    relationship: row.relationship,
    date_of_birth: row.date_of_birth,
    dob: row.date_of_birth,
    mobile: maskMobile(row.mobile) || row.mobile,
    email: maskEmail(row.email) || row.email,
    address: row.address,
    pan_number: maskPan(pan),
    aadhaar_number: maskAadhaar(aadhaar),
    pan_image: row.pan_image,
    aadhaar_image: row.aadhaar_image,
    allocation_percent: row.allocation_percent,
    is_minor: Boolean(row.is_minor),
    guardian_name: row.guardian_name,
    guardian_relationship: row.guardian_relationship,
    status: row.status || "active",
    added: true,
    message: "Nominee added",
  };
}

function formatKycForResponse(row) {
  if (!row) return null;
  return {
    ...row,
    pan_number: maskPan(row.pan_number) || row.pan_number,
    aadhaar_number: maskAadhaar(row.aadhaar_number) || row.aadhaar_number,
  };
}

function parseNomineeBody(body) {
  const nested =
    body.nominee && typeof body.nominee === "object" && !Array.isArray(body.nominee)
      ? body.nominee
      : {};

  return {
    nominee_name: body.nominee_name || body.nomineeName || nested.nominee_name || nested.nomineeName,
    relationship: body.relationship || nested.relationship,
    dob: body.dob || body.date_of_birth || body.dateOfBirth || nested.dob || nested.date_of_birth,
    mobile:
      body.nominee_mobile ||
      body.nomineeMobile ||
      nested.mobile ||
      nested.phone ||
      body.nominee_phone,
    email: body.nominee_email || body.nomineeEmail || nested.email,
    address: body.address || body.nominee_address || nested.address,
    pan_number:
      body.nominee_pan_number ||
      body.nomineePanNumber ||
      nested.pan_number ||
      nested.panNumber,
    aadhaar_number:
      body.nominee_aadhaar_number ||
      body.nomineeAadhaarNumber ||
      body.nominee_aadhaara_number ||
      nested.aadhaar_number ||
      nested.aadhaara_number ||
      nested.aadhaarNumber,
    guardian_name: body.guardian_name || body.guardianName || nested.guardian_name,
    guardian_relationship:
      body.guardian_relationship || body.guardianRelationship || nested.guardian_relationship,
    allocation_percent: body.allocation_percent || nested.allocation_percent,
  };
}

function hasNomineeUpdate(body) {
  const n = parseNomineeBody(body);
  return Boolean(
    n.nominee_name ||
      n.relationship ||
      n.dob ||
      n.mobile ||
      n.email ||
      n.address ||
      n.pan_number ||
      n.aadhaar_number ||
      n.guardian_name ||
      n.guardian_relationship ||
      n.allocation_percent != null ||
      body.nominee
  );
}

async function getProfile(req, res) {
  console.log("[PROFILE] get userId:", req.user?.id);
  try {
    const userId = req.user.id;

    const [users] = await pool.query(
      `SELECT id, full_name, email, phone, profile_image, role, kyc_status, kyc_method, created_at, updated_at
       FROM users WHERE id = :userId LIMIT 1`,
      { userId }
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = users[0];

    const [kycRows] = await pool.query(
      `SELECT pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image, method, status
       FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
      { userId }
    );

    const [nomineeRows] = await pool.query(
      `SELECT nominee_name, relationship, date_of_birth, mobile, email, address,
              pan_number, aadhaar_number, pan_image, aadhaar_image, allocation_percent,
              is_minor, guardian_name, guardian_relationship, status
       FROM nominees WHERE user_id = :userId LIMIT 1`,
      { userId }
    );

    const kyc = formatKycForResponse(kycRows[0] || null);
    const nominee = formatNomineeForResponse(nomineeRows[0] || null);

    return res.json({
      success: true,
      message: "Profile fetched successfully",
      data: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        profile_image: user.profile_image,
        role: user.role,
        aadhaar_number: kyc?.aadhaar_number || null,
        pan_number: kyc?.pan_number || null,
        kyc_status: user.kyc_status,
        kyc_method: user.kyc_method,
        kyc,
        nominee: nominee || {
          added: false,
          message: "Nominee not added",
        },
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error("[PROFILE] get error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
}

async function getUserPortfolio(req, res) {
  console.log("[PROFILE] portfolio userId:", req.user?.id);
  try {
    const userId = req.user.id;

    const [fds] = await pool.query(
      `SELECT * FROM portfolio_fds WHERE user_id = :userId AND status = 'active' ORDER BY created_at DESC`,
      { userId }
    );
    const [rds] = await pool.query(
      `SELECT * FROM portfolio_rds WHERE user_id = :userId AND status = 'active' ORDER BY created_at DESC`,
      { userId }
    );

    const fdInvested = fds.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const rdCommitted = rds.reduce(
      (s, r) => s + Number(r.monthly_amount || 0) * Number(r.tenure_months || 0),
      0
    );
    const fdMaturity = fds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);
    const rdMaturity = rds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);

    return res.json({
      success: true,
      message: "User portfolio fetched successfully",
      data: {
        summary: {
          total_fd_count: fds.length,
          total_rd_count: rds.length,
          total_fd_invested: Math.round(fdInvested * 100) / 100,
          total_rd_committed: Math.round(rdCommitted * 100) / 100,
          total_fd_maturity_value: Math.round(fdMaturity * 100) / 100,
          total_rd_maturity_value: Math.round(rdMaturity * 100) / 100,
          total_portfolio_value: Math.round((fdMaturity + rdMaturity) * 100) / 100,
        },
        fd: fds,
        rd: rds,
        links: {
          fd_routes: "/api/fd",
          rd_routes: "/api/market/rd",
        },
      },
    });
  } catch (error) {
    console.error("[PROFILE] portfolio error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch portfolio",
      error: error.message,
    });
  }
}

async function updateProfile(req, res) {
  console.log("[PROFILE] edit id:", req.params.id, "body:", req.body, "file:", req.file?.filename);
  try {
    const pathId = Number(req.params.id);
    const userId = req.user.id;

    if (!pathId || pathId !== Number(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own profile using your user id",
      });
    }

    // User's own KYC PAN / Aadhaar cannot be edited (top-level keys only).
    // Nominee identity uses nominee_* fields or nested nominee object — those ARE editable.
    const tryingUserKycIdentity =
      req.body.pan_number != null ||
      req.body.panNumber != null ||
      req.body.aadhaar_number != null ||
      req.body.aadhaarNumber != null ||
      req.body.aadhaara_number != null ||
      req.body.aadhaaraNumber != null ||
      req.body.user_pan_number != null ||
      req.body.user_aadhaar_number != null ||
      req.body.kyc_pan_number != null ||
      req.body.kyc_aadhaar_number != null;

    if (tryingUserKycIdentity) {
      return res.status(400).json({
        success: false,
        message:
          "User Aadhaar number and PAN card number cannot be edited. You can edit profile and nominee details.",
        editable_fields: [
          "full_name",
          "email",
          "phone",
          "profile_image",
          "nominee_name",
          "relationship",
          "dob",
          "nominee_mobile",
          "nominee_email",
          "address",
          "nominee_pan_number",
          "nominee_aadhaar_number",
        ],
        locked_fields: ["pan_number", "aadhaar_number"],
      });
    }

    const [users] = await pool.query(
      `SELECT id, full_name, email, phone, profile_image FROM users WHERE id = :userId LIMIT 1`,
      { userId }
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const current = users[0];

    const hasFullName = req.body.full_name != null || req.body.fullName != null;
    const hasEmail = req.body.email != null;
    const hasPhone =
      req.body.phone != null ||
      req.body.mobile != null ||
      req.body.phone_number != null ||
      req.body.phoneNumber != null ||
      req.body.mobile_number != null ||
      req.body.mobileNumber != null;

    let fullName = hasFullName
      ? sanitizeText(req.body.full_name || req.body.fullName || "", 150)
      : current.full_name;
    let email = hasEmail ? String(req.body.email || "").trim().toLowerCase() : current.email;
    let phone = current.phone;
    let profileImage = req.file?.filename || current.profile_image;

    if (hasFullName && !fullName) {
      return res.status(400).json({ success: false, message: "full_name cannot be empty" });
    }
    if (hasEmail && (!email || !isValidEmail(email))) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }
    if (hasPhone) {
      phone = String(
        req.body.phone ||
          req.body.mobile ||
          req.body.phone_number ||
          req.body.phoneNumber ||
          req.body.mobile_number ||
          req.body.mobileNumber ||
          ""
      )
        .replace(/\s+/g, "")
        .trim();
      if (!phone || !isValidPhone(phone)) {
        return res.status(400).json({
          success: false,
          message: "Valid 10-digit Indian mobile number is required",
        });
      }
    }

    const nomineeUpdate = hasNomineeUpdate(req.body);

    if (!hasFullName && !hasEmail && !hasPhone && !req.file && !nomineeUpdate) {
      return res.status(400).json({
        success: false,
        message:
          "Provide at least one editable field (profile or nominee). User PAN/Aadhaar cannot be edited.",
      });
    }

    if (email !== current.email) {
      const [emailExists] = await pool.query(
        `SELECT id FROM users WHERE email = :email AND id <> :userId LIMIT 1`,
        { email, userId }
      );
      if (emailExists.length) {
        return res.status(409).json({ success: false, message: "Email already in use" });
      }
    }

    if (phone !== current.phone) {
      const [phoneExists] = await pool.query(
        `SELECT id FROM users WHERE phone = :phone AND id <> :userId LIMIT 1`,
        { phone, userId }
      );
      if (phoneExists.length) {
        return res.status(409).json({ success: false, message: "Mobile number already in use" });
      }
    }

    await pool.query(
      `UPDATE users
       SET full_name = :fullName,
           email = :email,
           phone = :phone,
           profile_image = :profileImage
       WHERE id = :userId`,
      { fullName, email, phone, profileImage, userId }
    );

    let nomineeResult = null;

    if (nomineeUpdate) {
      const incoming = parseNomineeBody(req.body);
      const [existingRows] = await pool.query(
        `SELECT * FROM nominees WHERE user_id = :userId LIMIT 1`,
        { userId }
      );
      const existing = existingRows[0] || null;

      if (!existing && (!incoming.nominee_name || !incoming.relationship || !incoming.dob)) {
        return res.status(400).json({
          success: false,
          message:
            "To add nominee from profile, provide nominee_name, relationship and dob (plus other nominee fields)",
          allowed_relationships: SEBI_NOMINEE_RELATIONSHIPS,
        });
      }

      const nomineeName =
        sanitizeText(incoming.nominee_name || existing?.nominee_name || "", 150) || null;
      const relationship =
        normalizeRelationship(incoming.relationship || existing?.relationship || "") ||
        sanitizeText(incoming.relationship || existing?.relationship || "", 100) ||
        null;

      let dateOfBirth = existing?.date_of_birth
        ? String(existing.date_of_birth).slice(0, 10)
        : null;
      let isMinor = existing ? Boolean(existing.is_minor) : false;

      if (incoming.dob) {
        const dobParsed = parseDob(incoming.dob);
        if (!dobParsed) {
          return res.status(400).json({ success: false, message: "Invalid nominee dob" });
        }
        dateOfBirth = dobParsed.iso;
        isMinor = getAgeYears(dobParsed.date) < 18;
      }

      const nomineeMobile = incoming.mobile
        ? String(incoming.mobile).replace(/\s+/g, "").trim()
        : existing?.mobile;
      const nomineeEmail = incoming.email
        ? String(incoming.email).trim().toLowerCase()
        : existing?.email;
      const address =
        sanitizeText(incoming.address || existing?.address || "", 500) || existing?.address;

      if (nomineeMobile && !isValidPhone(nomineeMobile)) {
        return res.status(400).json({
          success: false,
          message: "Valid nominee mobile number is required",
        });
      }
      if (nomineeEmail && !isValidEmail(nomineeEmail)) {
        return res.status(400).json({
          success: false,
          message: "Valid nominee email is required",
        });
      }

      let panPlain = existing ? decryptPii(existing.pan_number) || existing.pan_number : null;
      let aadhaarPlain = existing
        ? decryptPii(existing.aadhaar_number) || existing.aadhaar_number
        : null;

      if (incoming.pan_number) {
        panPlain = normalizePan(incoming.pan_number);
        if (!isValidPan(panPlain)) {
          return res.status(400).json({ success: false, message: "Valid nominee PAN is required" });
        }
      }
      if (incoming.aadhaar_number) {
        aadhaarPlain = normalizeAadhaar(incoming.aadhaar_number);
        if (!isValidAadhaar(aadhaarPlain)) {
          return res.status(400).json({
            success: false,
            message: "Valid nominee Aadhaar number is required",
          });
        }
      }

      const guardianName =
        sanitizeText(incoming.guardian_name || existing?.guardian_name || "", 150) || null;
      const guardianRelationship =
        normalizeRelationship(
          incoming.guardian_relationship || existing?.guardian_relationship || ""
        ) ||
        sanitizeText(
          incoming.guardian_relationship || existing?.guardian_relationship || "",
          100
        ) ||
        null;

      if (isMinor && (!guardianName || !guardianRelationship)) {
        return res.status(400).json({
          success: false,
          message: "Minor nominee requires guardian_name and guardian_relationship",
        });
      }

      const allocationPercent = Number(
        incoming.allocation_percent != null
          ? incoming.allocation_percent
          : existing?.allocation_percent || 100
      );

      if (!nomineeName || !relationship || !dateOfBirth || !nomineeMobile || !nomineeEmail || !address || !panPlain || !aadhaarPlain) {
        return res.status(400).json({
          success: false,
          message:
            "Nominee requires name, relationship, dob, mobile, email, address, pan and aadhaar",
        });
      }

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
          allocation_percent = VALUES(allocation_percent),
          is_minor = VALUES(is_minor),
          guardian_name = VALUES(guardian_name),
          guardian_relationship = VALUES(guardian_relationship),
          status = 'active'`,
        {
          userId,
          nomineeName,
          relationship,
          dateOfBirth,
          mobile: nomineeMobile,
          email: nomineeEmail,
          address,
          panNumber: encryptPii(panPlain),
          aadhaarNumber: encryptPii(aadhaarPlain),
          panImage: existing?.pan_image || null,
          aadhaarImage: existing?.aadhaar_image || null,
          allocationPercent,
          isMinor: isMinor ? 1 : 0,
          guardianName: isMinor ? guardianName : null,
          guardianRelationship: isMinor ? guardianRelationship : null,
        }
      );

      const [updatedNominee] = await pool.query(
        `SELECT * FROM nominees WHERE user_id = :userId LIMIT 1`,
        { userId }
      );
      nomineeResult = formatNomineeForResponse(updatedNominee[0] || null);
    } else {
      const [nomineeRows] = await pool.query(
        `SELECT * FROM nominees WHERE user_id = :userId LIMIT 1`,
        { userId }
      );
      nomineeResult = formatNomineeForResponse(nomineeRows[0] || null);
    }

    await writeAuditLog({
      userId,
      action: "PROFILE_UPDATE",
      entityType: "user",
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { email, phone, nominee_updated: nomineeUpdate },
    });

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: userId,
        full_name: fullName,
        email,
        phone,
        mobile: phone,
        profile_image: profileImage,
        nominee: nomineeResult || {
          added: false,
          message: "Nominee not added",
        },
        locked_fields: ["pan_number", "aadhaar_number"],
        note: "User PAN and Aadhaar cannot be edited. Nominee and other profile fields can be edited.",
      },
    });
  } catch (error) {
    console.error("[PROFILE] edit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message,
    });
  }
}

module.exports = {
  getProfile,
  getUserPortfolio,
  updateProfile,
};
