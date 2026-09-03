const { hasRecentCheck, RATE_LIMIT_HOURS } = require("../services/creditCheckService");

async function creditCheckRateLimit(req, res, next) {
  try {
    const userId = Number(req.body?.userId || req.body?.user_id || req.params?.userId);
    const bureau = String(req.body?.bureau || "").toUpperCase();

    if (!userId || !bureau) {
      return next();
    }

    const recent = await hasRecentCheck(userId, bureau);
    if (recent) {
      return res.status(429).json({
        success: false,
        message: `Credit check for ${bureau} already performed within the last ${RATE_LIMIT_HOURS} hours`,
      });
    }

    return next();
  } catch (error) {
    console.error("[CREDIT-CHECK] rate limit error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to verify credit check rate limit",
    });
  }
}

module.exports = { creditCheckRateLimit };
