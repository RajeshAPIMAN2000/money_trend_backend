/**
 * Lightweight IP rate limit for email OTP endpoints (in-memory + DB also limits).
 * Compatible with existing Express middleware style.
 */

const hits = new Map();

function emailOtpIpRateLimit(req, res, next) {
  const windowMs =
    Number(process.env.OTP_IP_WINDOW_MINUTES || 15) * 60 * 1000;
  const max = Number(process.env.OTP_MAX_SENDS_PER_IP || 20);
  const ip = String(req.ip || req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const key = `email_otp:${ip}`;

  let bucket = hits.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    hits.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > max) {
    return res.status(429).json({
      success: false,
      message: "Too many OTP requests. Please try again later.",
      errorCode: "IP_RATE_LIMITED",
    });
  }

  return next();
}

module.exports = { emailOtpIpRateLimit };
