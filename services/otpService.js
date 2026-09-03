const crypto = require("crypto");
const pool = require("../config/db");
const { isValidPhone } = require("../utils/validators");
const { sendSms } = require("./sms/smsProvider");

const OTP_LENGTH = Number(process.env.OTP_LENGTH) || 6;
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 15;
const OTP_RESEND_COOLDOWN_SEC = Number(process.env.OTP_RESEND_COOLDOWN_SEC) || 60;
const OTP_MAX_SENDS_PER_WINDOW = Number(process.env.OTP_MAX_SENDS_PER_WINDOW) || 3;
const OTP_SEND_WINDOW_MINUTES = Number(process.env.OTP_SEND_WINDOW_MINUTES) || 15;
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;

const OTP_PURPOSES = ["register", "login", "forgot_password"];

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "").trim();
}

function maskPhone(phone) {
  const p = normalizePhone(phone);
  if (p.length < 4) return "****";
  return `${"*".repeat(p.length - 4)}${p.slice(-4)}`;
}

function generateOtpCode() {
  const max = 10 ** OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(OTP_LENGTH, "0");
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(String(otp)).digest("hex");
}

function buildOtpMessage(otp, purpose) {
  const appName = process.env.APP_NAME || "Money Trend";
  if (purpose === "register") {
    return `Your ${appName} registration OTP is ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.`;
  }
  if (purpose === "forgot_password") {
    return `Your ${appName} password reset OTP is ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.`;
  }
  return `Your ${appName} login OTP is ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.`;
}

async function countRecentSends(phone, purpose) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM otp_verifications
     WHERE phone = :phone AND purpose = :purpose
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${OTP_SEND_WINDOW_MINUTES} MINUTE)`,
    { phone, purpose }
  );
  return Number(rows[0]?.total || 0);
}

async function getLatestOtp(phone, purpose) {
  const [rows] = await pool.query(
    `SELECT id, otp_hash, expires_at, attempts, verified, created_at
     FROM otp_verifications
     WHERE phone = :phone AND purpose = :purpose
     ORDER BY created_at DESC
     LIMIT 1`,
    { phone, purpose }
  );
  return rows[0] || null;
}

async function invalidatePreviousOtps(phone, purpose) {
  await pool.query(
    `UPDATE otp_verifications SET verified = 1
     WHERE phone = :phone AND purpose = :purpose AND verified = 0`,
    { phone, purpose }
  );
}

async function sendOtp(phone, purpose) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    const err = new Error("Phone number must be a valid 10-digit Indian mobile number");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const safePurpose = String(purpose || "").toLowerCase();
  if (!OTP_PURPOSES.includes(safePurpose)) {
    const err = new Error("purpose must be register, login or forgot_password");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const recentCount = await countRecentSends(normalizedPhone, safePurpose);
  if (recentCount >= OTP_MAX_SENDS_PER_WINDOW) {
    const err = new Error("Too many OTP requests. Please try again later.");
    err.code = "RATE_LIMITED";
    throw err;
  }

  const latest = await getLatestOtp(normalizedPhone, safePurpose);
  if (latest && !latest.verified) {
    const secondsSince = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    if (secondsSince < OTP_RESEND_COOLDOWN_SEC) {
      const wait = Math.ceil(OTP_RESEND_COOLDOWN_SEC - secondsSince);
      const err = new Error(`Please wait ${wait} seconds before requesting a new OTP`);
      err.code = "COOLDOWN";
      err.retryAfter = wait;
      throw err;
    }
  }

  const otp = generateOtpCode();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await invalidatePreviousOtps(normalizedPhone, safePurpose);
  await pool.query(
    `INSERT INTO otp_verifications (phone, purpose, otp_hash, expires_at)
     VALUES (:phone, :purpose, :otpHash, :expiresAt)`,
    { phone: normalizedPhone, purpose: safePurpose, otpHash, expiresAt }
  );

  await sendSms(normalizedPhone, buildOtpMessage(otp, safePurpose));

  const payload = {
    phone: normalizedPhone,
    phone_masked: maskPhone(normalizedPhone),
    purpose: safePurpose,
    expires_in: OTP_EXPIRY_MINUTES * 60,
    message: "OTP sent to your phone number via SMS",
  };

  if (process.env.NODE_ENV !== "production" && String(process.env.SMS_MODE || "sandbox") === "sandbox") {
    payload.debug_otp = otp;
  }

  return payload;
}

async function resendOtp(phone, purpose) {
  return sendOtp(phone, purpose);
}

async function verifyOtp(phone, purpose, otp) {
  const normalizedPhone = normalizePhone(phone);
  const safePurpose = String(purpose || "").toLowerCase();
  const otpValue = String(otp || "").trim();

  if (!isValidPhone(normalizedPhone)) {
    const err = new Error("Invalid phone number");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (!OTP_PURPOSES.includes(safePurpose)) {
    const err = new Error("Invalid OTP purpose");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (!/^\d{4,8}$/.test(otpValue)) {
    const err = new Error("Invalid OTP");
    err.code = "INVALID_OTP";
    throw err;
  }

  const record = await getLatestOtp(normalizedPhone, safePurpose);
  if (!record || record.verified) {
    const err = new Error("OTP expired or not found. Please request a new OTP.");
    err.code = "OTP_EXPIRED";
    throw err;
  }

  if (new Date(record.expires_at) < new Date()) {
    const err = new Error("OTP has expired. Please request a new OTP.");
    err.code = "OTP_EXPIRED";
    throw err;
  }

  if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    const err = new Error("Maximum OTP attempts exceeded. Please request a new OTP.");
    err.code = "OTP_LOCKED";
    throw err;
  }

  const matched = hashOtp(otpValue) === record.otp_hash;
  await pool.query(`UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = :id`, {
    id: record.id,
  });

  if (!matched) {
    const err = new Error("Invalid OTP");
    err.code = "INVALID_OTP";
    throw err;
  }

  await pool.query(`UPDATE otp_verifications SET verified = 1 WHERE id = :id`, { id: record.id });
  return { verified: true, phone: normalizedPhone, purpose: safePurpose };
}

module.exports = {
  OTP_PURPOSES,
  normalizePhone,
  maskPhone,
  sendOtp,
  resendOtp,
  verifyOtp,
};
