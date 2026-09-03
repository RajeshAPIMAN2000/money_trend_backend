const {
  runCreditCheck,
  runAllBureaus,
  getHistory,
  getCheckById,
  formatCheckDetail,
} = require("../services/creditCheckService");

function resolveTargetUserId(req) {
  const fromBody = req.body?.userId || req.body?.user_id;
  const fromParams = req.params?.userId;
  return Number(fromBody || fromParams);
}

function assertUserAccess(req, targetUserId) {
  if (req.user.role === "admin") return true;
  return Number(req.user.id) === Number(targetUserId);
}

async function runCheck(req, res) {
  try {
    const userId = resolveTargetUserId(req);
    const bureau = req.body.bureau;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (!assertUserAccess(req, userId)) {
      return res.status(403).json({ success: false, message: "Access denied for this user" });
    }

    const requestedBy = req.user.role === "admin" ? "ADMIN" : "USER";
    const consent = req.creditConsent;

    const result = await runCreditCheck({
      userId,
      bureau,
      requestedBy,
      consentGiven: consent.consentGiven,
      consentTimestamp: consent.consentTimestamp,
      consentIp: consent.consentIp,
      consentVersion: consent.consentVersion,
    });

    return res.status(201).json({
      success: true,
      message: "Credit check completed",
      data: result,
    });
  } catch (error) {
    console.error("[CREDIT-CHECK] run error:", error.message);
    const status =
      error.code === "KYC_NOT_VERIFIED"
        ? 403
        : error.code === "USER_NOT_FOUND"
          ? 404
          : 502;
    return res.status(status).json({
      success: false,
      message: error.message || "Credit check failed",
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
    if (!assertUserAccess(req, row.user_id)) {
      return res.status(403).json({ success: false, message: "Access denied for this check" });
    }

    return res.json({
      success: true,
      data: formatCheckDetail(row),
    });
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
    return res.status(502).json({
      success: false,
      message: error.message || "Multi-bureau credit check failed",
    });
  }
}

module.exports = {
  runCheck,
  getCheckHistory,
  getCheckDetail,
  runAllChecks,
};
