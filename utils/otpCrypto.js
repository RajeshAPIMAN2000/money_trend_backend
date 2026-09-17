const crypto = require("crypto");

function generateSecureOtp(length = 6) {
  const len = Math.min(Math.max(Number(length) || 6, 4), 8);
  const max = 10 ** len;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(len, "0");
}

function hashOtp(otp, salt = process.env.OTP_HASH_PEPPER || "") {
  return crypto.createHash("sha256").update(`${salt}${String(otp)}`).digest("hex");
}

/** Constant-time comparison of two hex hashes (or equal-length strings). */
function safeEqualHash(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) {
    // still do a compare to reduce timing signal on length mismatch path
    crypto.timingSafeEqual(left.length ? left : Buffer.alloc(1), left.length ? left : Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function maskEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function hashEmailForLog(email) {
  return crypto.createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex").slice(0, 16);
}

module.exports = {
  generateSecureOtp,
  hashOtp,
  safeEqualHash,
  maskEmail,
  hashEmailForLog,
};
