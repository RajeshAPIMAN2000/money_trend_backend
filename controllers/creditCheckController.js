const {
  runCreditCheck,
  runPublicCreditCheck,
  runAllBureaus,
  getHistory,
  getHistoryByPhone,
  getCheckById,
  formatCheckDetail,
  listAdminCreditChecksWithUsers,
  getLatestScores,
  getLatestScoresByPhone,
} = require("../services/creditCheckService");
// OTP disabled for now — uncomment when credit-check OTP is required again
// const { sendOtp, resendOtp, verifyOtp, maskPhone } = require("../services/otpService");
const pool = require("../config/db");
const { isValidPhone } = require("../utils/validators");

// const CREDIT_CHECK_OTP_PURPOSE = "credit_check";

function resolveTargetUserId(req) {
  const fromBody = req.body?.userId || req.body?.user_id;
  const fromParams = req.params?.userId;
  // Default to authenticated user when userId omitted (frontend convenience).
  return Number(fromBody || fromParams || req.user?.id) || null;
}

function assertUserAccess(req, targetUserId) {
  if (!req.user) return false;
  if (req.user.role === "admin") return true;
  return Number(req.user.id) === Number(targetUserId);
}

function mapOtpError(error) {
  const code = error.code || "";
  if (code === "VALIDATION_ERROR") return { status: 400, message: error.message };
  if (code === "RATE_LIMITED") return { status: 429, message: error.message };
  if (code === "COOLDOWN") {
    return { status: 429, message: error.message, retryAfter: error.retryAfter };
  }
  if (code === "INVALID_OTP") return { status: 400, message: error.message };
  if (code === "OTP_EXPIRED") return { status: 400, message: error.message };
  if (code === "OTP_LOCKED") return { status: 429, message: error.message };
  return null;
}

function mapCreditCheckError(error) {
  const otpMapped = mapOtpError(error);
  if (otpMapped) return otpMapped;

  const code = error.code || "";
  if (code === "VALIDATION_ERROR") return { status: 400, message: error.message };
  if (code === "KYC_NOT_VERIFIED") return { status: 403, message: error.message };
  if (code === "USER_NOT_FOUND") return { status: 404, message: error.message };
  if (code === "EXPERIAN_CREDENTIALS_MISSING" || code === "EXPERIAN_ENDPOINT_NOT_CONFIGURED") {
    return { status: 503, message: "Experian India integration is not fully configured on the server" };
  }
  if (code === "EXPERIAN_REQUEST_SCHEMA_NOT_CONFIGURED") {
    return {
      status: 503,
      message:
        "Experian India credit-check request schema is not configured. Contact the backend team.",
    };
  }
  if (code === "EXPERIAN_OAUTH_UNAUTHORIZED") {
    return { status: 502, message: "Experian authentication failed" };
  }
  if (code === "EXPERIAN_OAUTH_RATE_LIMITED" || code === "BUREAU_RATE_LIMITED") {
    return { status: 429, message: "Credit bureau rate limit exceeded. Try again later." };
  }
  if (code === "BUREAU_UNAUTHORIZED" || code === "BUREAU_FORBIDDEN") {
    return { status: 502, message: "Credit bureau authorization failed" };
  }
  if (code === "BUREAU_BAD_REQUEST" || code === "BUREAU_UNPROCESSABLE") {
    return { status: 422, message: "Credit bureau rejected the applicant data" };
  }
  if (code === "BUREAU_UNAVAILABLE" || code === "BUREAU_BAD_GATEWAY" || code === "BUREAU_TIMEOUT_GATEWAY") {
    return { status: 502, message: "Credit bureau temporarily unavailable" };
  }
  if (error.status === 429) return { status: 429, message: "Too many requests" };
  return { status: 502, message: error.message || "Credit check failed" };
}

async function loadUserPhone(userId) {
  const [rows] = await pool.query(
    `SELECT id, phone, kyc_status FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );
  if (!rows.length) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  return rows[0];
}

/**
 * OTP helpers — disabled (no OTP required for credit check currently).
 * Uncomment routes in routes/creditCheck.js and the OTP block in runCheck to re-enable.
 */
async function sendCreditCheckOtp(req, res) {
  return res.status(503).json({
    success: false,
    message: "Credit-check OTP is currently disabled",
  });
  /*
  try {
    const userId = resolveTargetUserId(req);
    if (!assertUserAccess(req, userId)) {
      return res.status(403).json({ success: false, message: "Access denied for this user" });
    }

    await loadKycForCreditCheck(userId);
    const user = await loadUserPhone(userId);
    const data = await sendOtp(user.phone, CREDIT_CHECK_OTP_PURPOSE);

    return res.json({
      success: true,
      message: "OTP sent to your registered mobile number",
      data: {
        ...data,
        user_id: userId,
        next_step: "Enter OTP and call POST /api/credit-check with otp + consent",
      },
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] send-otp error:", error.code || error.message);
    const mapped = mapCreditCheckError(error);
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
      errorCode: error.code || undefined,
      retryAfter: mapped.retryAfter,
    });
  }
  */
}

async function resendCreditCheckOtp(req, res) {
  return res.status(503).json({
    success: false,
    message: "Credit-check OTP is currently disabled",
  });
  /*
  try {
    const userId = resolveTargetUserId(req);
    if (!assertUserAccess(req, userId)) {
      return res.status(403).json({ success: false, message: "Access denied for this user" });
    }

    await loadKycForCreditCheck(userId);
    const user = await loadUserPhone(userId);
    const data = await resendOtp(user.phone, CREDIT_CHECK_OTP_PURPOSE);

    return res.json({
      success: true,
      message: "OTP resent to your registered mobile number",
      data: {
        ...data,
        user_id: userId,
      },
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] resend-otp error:", error.code || error.message);
    const mapped = mapCreditCheckError(error);
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
      errorCode: error.code || undefined,
      retryAfter: mapped.retryAfter,
    });
  }
  */
}

async function runCheck(req, res) {
  try {
    const bureau = String(req.body.bureau || "CIBIL").toUpperCase();
    const consent = req.creditConsent;
    const loggedInUserId = req.user?.id ? Number(req.user.id) : null;

    let result;

    // Public / no-login path: applicant details in body
    const hasPublicApplicant =
      req.body.pan ||
      req.body.fullName ||
      req.body.full_name ||
      req.body.mobile ||
      req.body.phone ||
      req.body.dateOfBirth ||
      req.body.date_of_birth;

    if (!loggedInUserId || hasPublicApplicant) {
      // Prefer public form details when provided (works with or without login)
      if (hasPublicApplicant || !loggedInUserId) {
        result = await runPublicCreditCheck({
          bureau,
          fullName: req.body.fullName || req.body.full_name,
          pan: req.body.pan,
          mobile: req.body.mobile || req.body.phone,
          dob: req.body.dateOfBirth || req.body.date_of_birth || req.body.dob,
          address: req.body.address || null,
          consentGiven: consent.consentGiven,
          consentTimestamp: consent.consentTimestamp,
          consentIp: consent.consentIp,
          consentVersion: consent.consentVersion,
        });
      }
    }

    // Logged-in path without form PII: use verified KYC on file
    if (!result && loggedInUserId) {
      if (req.user.role !== "admin") {
        // own account only
      } else if (req.body.userId || req.body.user_id) {
        // admin may target another user via KYC path
      }
      const targetUserId = resolveTargetUserId(req);
      if (req.user && !assertUserAccess(req, targetUserId) && req.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Access denied for this user" });
      }
      result = await runCreditCheck({
        userId: targetUserId,
        bureau,
        requestedBy: req.user.role === "admin" ? "ADMIN" : "USER",
        consentGiven: consent.consentGiven,
        consentTimestamp: consent.consentTimestamp,
        consentIp: consent.consentIp,
        consentVersion: consent.consentVersion,
      });
    }

    if (!result) {
      return res.status(400).json({
        success: false,
        message:
          "Provide pan, fullName, mobile, dateOfBirth (no login required), or login and use verified KYC",
      });
    }

    return res.status(201).json({
      success: true,
      message: `${result.score_label || "Credit score"} fetched and saved`,
      data: {
        provider: result.bureau,
        score: result.score,
        scoreBand: result.score_band,
        scoreLabel: result.score_label,
        reportAvailable: result.reportAvailable,
        referenceId: result.report_ref_id,
        status: result.status,
        loginRequired: false,
        check: result,
      },
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] run error:", error.code || error.message);
    const mapped = mapCreditCheckError(error);
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
      errorCode: error.code || undefined,
      retryAfter: mapped.retryAfter,
    });
  }
}

async function getMyLatestScore(req, res) {
  try {
    if (req.user?.id) {
      const data = await getLatestScores(req.user.id);
      return res.json({ success: true, message: "Latest credit scores", data });
    }

    const mobile = String(req.query.mobile || req.query.phone || "").replace(/\s+/g, "").trim();
    if (!isValidPhone(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Pass ?mobile=10digit (no login) or send Authorization Bearer token",
      });
    }

    const data = await getLatestScoresByPhone(mobile);
    return res.json({ success: true, message: "Latest credit scores", data });
  } catch (error) {
    console.error("[CREDIT-CHECK] latest error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch latest credit score",
    });
  }
}

async function getMyCheckHistory(req, res) {
  try {
    if (req.user?.id) {
      const history = await getHistory(req.user.id);
      return res.json({ success: true, data: history });
    }

    const mobile = String(req.query.mobile || req.query.phone || "").replace(/\s+/g, "").trim();
    if (!isValidPhone(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Pass ?mobile=10digit (no login) or send Authorization Bearer token",
      });
    }

    const history = await getHistoryByPhone(mobile);
    return res.json({ success: true, data: history });
  } catch (error) {
    console.error("[CREDIT-CHECK] my-history error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch credit check history",
    });
  }
}

async function getCheckHistory(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    if (!assertUserAccess(req, userId)) {
      return res.status(403).json({ success: false, message: "Access denied for this user" });
    }

    const history = await getHistory(userId);
    return res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] history error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch credit check history",
    });
  }
}

async function getCheckDetail(req, res) {
  try {
    const checkId = Number(req.params.id);
    const row = await getCheckById(checkId);
    if (!row) {
      return res.status(404).json({ success: false, message: "Credit check not found" });
    }

    // Owner / admin via JWT
    if (req.user && assertUserAccess(req, row.user_id)) {
      return res.json({ success: true, data: formatCheckDetail(row) });
    }

    // Guest access: match mobile query/body to stored guest_phone
    const mobile = String(req.query.mobile || req.query.phone || req.body?.mobile || "")
      .replace(/\s+/g, "")
      .trim();
    if (mobile && row.guest_phone && mobile === String(row.guest_phone)) {
      return res.json({ success: true, data: formatCheckDetail(row) });
    }

    if (!req.user && !mobile) {
      return res.status(400).json({
        success: false,
        message: "Pass ?mobile=10digit or login to view this credit check",
      });
    }

    return res.status(403).json({ success: false, message: "Access denied for this check" });
  } catch (error) {
    console.error("[CREDIT-CHECK] detail error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch credit check detail",
    });
  }
}

async function runAllChecks(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const consent = req.creditConsent;
    const { results, errors } = await runAllBureaus({
      userId,
      requestedBy: "ADMIN",
      consentGiven: consent.consentGiven,
      consentTimestamp: consent.consentTimestamp,
      consentIp: consent.consentIp,
      consentVersion: consent.consentVersion,
    });

    return res.status(201).json({
      success: true,
      message: "Multi-bureau credit check completed",
      data: { results, errors },
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] run-all error:", error.message);
    const mapped = mapCreditCheckError(error);
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
}

async function adminListCreditChecks(req, res) {
  try {
    const data = await listAdminCreditChecksWithUsers({
      bureau: req.query.bureau,
      status: req.query.status,
      userId: req.query.user_id || req.query.userId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, message: "Credit checks fetched", data });
  } catch (error) {
    console.error("[CREDIT-CHECK] admin list error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to list credit checks" });
  }
}

async function adminGetCreditCheck(req, res) {
  try {
    const checkId = Number(req.params.id);
    const row = await getCheckById(checkId);
    if (!row) {
      return res.status(404).json({ success: false, message: "Credit check not found" });
    }
    return res.json({ success: true, data: formatCheckDetail(row) });
  } catch (error) {
    console.error("[CREDIT-CHECK] admin detail error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch credit check" });
  }
}

async function adminGetUserCreditScores(req, res) {
  try {
    const userId = Number(req.params.userId || req.params.id);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Valid user id is required" });
    }
    const data = await getLatestScores(userId);
    const history = await getHistory(userId);
    return res.json({
      success: true,
      message: "User credit scores fetched",
      data: {
        ...data,
        history,
      },
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] admin user scores error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch user credit scores" });
  }
}

module.exports = {
  sendCreditCheckOtp,
  resendCreditCheckOtp,
  runCheck,
  getMyLatestScore,
  getMyCheckHistory,
  getCheckHistory,
  getCheckDetail,
  runAllChecks,
  adminListCreditChecks,
  adminGetCreditCheck,
  adminGetUserCreditScores,
};
