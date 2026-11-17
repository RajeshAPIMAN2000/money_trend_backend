const hits = new Map();

function digilockerRateLimit(req, res, next) {
  const windowMs = Number(process.env.DIGILOCKER_RATE_WINDOW_MINUTES || 15) * 60 * 1000;
  const max = Number(process.env.DIGILOCKER_RATE_MAX || 20);
  const ip = String(req.ip || req.headers["x-forwarded-for"] || "unknown")
    .split(",")[0]
    .trim();
  const userPart = req.user?.id ? `u${req.user.id}` : "anon";
  const key = `digilocker:${ip}:${userPart}`;
  const now = Date.now();

  let bucket = hits.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    hits.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > max) {
    return res.status(429).json({
      success: false,
      message: "Too many DigiLocker requests. Please try again later.",
      errorCode: "DIGILOCKER_RATE_LIMITED",
    });
  }
  return next();
}

module.exports = { digilockerRateLimit };
