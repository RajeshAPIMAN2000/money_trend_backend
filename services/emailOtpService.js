const pool = require("../config/db");
const { isValidEmail } = require("../utils/validators");
const {
  generateSecureOtp,
  hashOtp,
  safeEqualHash,
  maskEmail,
} = require("../utils/otpCrypto");
const { getEmailConfig } = require("./email/emailConfig");
const { sendOtpEmail } = require("./emailService");

const EMAIL_OTP_PURPOSES = [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
  "LOGIN_VERIFICATION",
  "CHANGE_EMAIL",
  "TRANSACTION_VERIFICATION",
];

/** Map legacy / friendly aliases to canonical purposes */
const PURPOSE_ALIASES = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  email_verification: "EMAIL_VERIFICATION",
  register: "EMAIL_VERIFICATION",
  REGISTER: "EMAIL_VERIFICATION",
  verification: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
  password_reset: "PASSWORD_RESET",
  forgot_password: "PASSWORD_RESET",
  FORGOT_PASSWORD: "PASSWORD_RESET",
  LOGIN_VERIFICATION: "LOGIN_VERIFICATION",
  login_verification: "LOGIN_VERIFICATION",
  login: "LOGIN_VERIFICATION",
  LOGIN: "LOGIN_VERIFICATION",
  CHANGE_EMAIL: "CHANGE_EMAIL",
  change_email: "CHANGE_EMAIL",
  TRANSACTION_VERIFICATION: "TRANSACTION_VERIFICATION",
  transaction_verification: "TRANSACTION_VERIFICATION",
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePurpose(purpose) {
  const raw = String(purpose || "").trim();
  return PURPOSE_ALIASES[raw] || PURPOSE_ALIASES[raw.toUpperCase()] || null;
}

function firstNameFrom(fullName) {
  const part = String(fullName || "").trim().split(/\s+/)[0];
  return part || null;
}

async function countRecentEmailSends(email, purpose) {
  const cfg = getEmailConfig();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM email_otp_verifications
     WHERE email = :email AND purpose = :purpose
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${cfg.otpSendWindowMinutes} MINUTE)`,
    { email, purpose }
  );
  return Number(rows[0]?.total || 0);
}

async function countRecentIpSends(ipAddress) {
  const cfg = getEmailConfig();
  if (!ipAddress) return 0;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM email_otp_verifications
     WHERE ip_address = :ip
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${cfg.otpIpWindowMinutes} MINUTE)`,
    { ip: String(ipAddress).slice(0, 64) }
  );
  return Number(rows[0]?.total || 0);
}

async function getLatestActiveOtp(email, purpose) {
  const [rows] = await pool.query(
    `SELECT id, user_id, email, otp_hash, purpose, attempts, expires_at, verified_at, created_at
     FROM email_otp_verifications
     WHERE email = :email AND purpose = :purpose AND verified_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    { email, purpose }
  );
  return rows[0] || null;
}

async function invalidateActiveOtps(email, purpose) {
  await pool.query(
    `UPDATE email_otp_verifications
     SET verified_at = COALESCE(verified_at, NOW())
     WHERE email = :email AND purpose = :purpose AND verified_at IS NULL`,
    { email, purpose }
  );
}

/**
 * Send email OTP. Never returns the OTP.
 * Generic success messaging to reduce enumeration where applicable.
 */
async function sendEmailOtp({
  email,
  purpose,
  userId = null,
  firstName = null,
  ipAddress = null,
  requireExistingUser = false,
  requireMissingUser = false,
}) {
  const cfg = getEmailConfig();
  const normalizedEmail = normalizeEmail(email);
  const safePurpose = normalizePurpose(purpose);

  if (!isValidEmail(normalizedEmail)) {
    const err = new Error("Invalid email address");
    err.code = "VALIDATION_ERROR";
    err.errorCode = "INVALID_EMAIL";
    throw err;
  }
  if (!safePurpose) {
    const err = new Error(`purpose must be one of: ${EMAIL_OTP_PURPOSES.join(", ")}`);
    err.code = "VALIDATION_ERROR";
    err.errorCode = "INVALID_PURPOSE";
    throw err;
  }

  const ipCount = await countRecentIpSends(ipAddress);
  if (ipCount >= cfg.otpMaxSendsPerIpWindow) {
    const err = new Error("Too many OTP requests. Please try again later.");
    err.code = "RATE_LIMITED";
    err.errorCode = "IP_RATE_LIMITED";
    err.status = 429;
    throw err;
  }

  const recentCount = await countRecentEmailSends(normalizedEmail, safePurpose);
  if (recentCount >= cfg.otpMaxSendsPerEmailWindow) {
    const err = new Error("Too many OTP requests. Please try again later.");
    err.code = "RATE_LIMITED";
    err.errorCode = "EMAIL_RATE_LIMITED";
    err.status = 429;
    throw err;
  }

  const latest = await getLatestActiveOtp(normalizedEmail, safePurpose);
  if (latest) {
    const secondsSince = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    if (secondsSince < cfg.otpResendCooldownSeconds) {
      const wait = Math.ceil(cfg.otpResendCooldownSeconds - secondsSince);
      const err = new Error(`Please wait ${wait} seconds before requesting a new OTP`);
      err.code = "COOLDOWN";
      err.errorCode = "RESEND_COOLDOWN";
      err.retryAfter = wait;
      err.status = 429;
      throw err;
    }
  }

  let resolvedUserId = userId;
  let resolvedFirstName = firstName;

  const [users] = await pool.query(
    `SELECT id, full_name, email, email_verified_at FROM users WHERE email = :email LIMIT 1`,
    { email: normalizedEmail }
  );
  const user = users[0] || null;

  if (requireExistingUser && !user) {
    // Enumeration-safe: pretend success without sending
    console.log("[EMAIL_OTP] skipped send", {
      reason: "user_not_found",
      purpose: safePurpose,
      email_masked: maskEmail(normalizedEmail),
    });
    return {
      sent: false,
      generic: true,
      email_masked: maskEmail(normalizedEmail),
      purpose: safePurpose,
      expires_in: cfg.otpExpiryMinutes * 60,
    };
  }
  if (requireMissingUser && user) {
    console.log("[EMAIL_OTP] skipped send", {
      reason: "email_already_registered",
      purpose: safePurpose,
      email_masked: maskEmail(normalizedEmail),
    });
    return {
      sent: false,
      generic: true,
      email_masked: maskEmail(normalizedEmail),
      purpose: safePurpose,
      expires_in: cfg.otpExpiryMinutes * 60,
    };
  }

  if (user) {
    resolvedUserId = user.id;
    resolvedFirstName = resolvedFirstName || firstNameFrom(user.full_name);
  }

  if (safePurpose === "EMAIL_VERIFICATION" && user?.email_verified_at) {
    console.log("[EMAIL_OTP] skipped send", {
      reason: "already_verified",
      purpose: safePurpose,
      email_masked: maskEmail(normalizedEmail),
    });
    return {
      sent: false,
      already_verified: true,
      generic: true,
      email_masked: maskEmail(normalizedEmail),
      purpose: safePurpose,
      expires_in: cfg.otpExpiryMinutes * 60,
    };
  }

  const otp = generateSecureOtp(6);
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + cfg.otpExpiryMinutes * 60 * 1000);

  await invalidateActiveOtps(normalizedEmail, safePurpose);

  await pool.query(
    `INSERT INTO email_otp_verifications
      (user_id, email, otp_hash, purpose, attempts, expires_at, ip_address)
     VALUES
      (:userId, :email, :otpHash, :purpose, 0, :expiresAt, :ip)`,
    {
      userId: resolvedUserId || null,
      email: normalizedEmail,
      otpHash,
      purpose: safePurpose,
      expiresAt,
      ip: ipAddress ? String(ipAddress).slice(0, 64) : null,
    }
  );

  // SMTP (e.g. GoDaddy) can be slow — don't block the API for the full round-trip.
  // OTP is already stored; email continues in background. Failures are logged.
  const asyncOtp =
    String(process.env.EMAIL_OTP_ASYNC || "true").toLowerCase() !== "false";

  if (asyncOtp) {
    sendOtpEmail({
      to: normalizedEmail,
      firstName: resolvedFirstName,
      otp,
      purpose: safePurpose,
      expiresMinutes: cfg.otpExpiryMinutes,
    }).catch((mailErr) => {
      console.error("[EMAIL_OTP] background send failed:", mailErr.message || mailErr);
    });
  } else {
    try {
      await sendOtpEmail({
        to: normalizedEmail,
        firstName: resolvedFirstName,
        otp,
        purpose: safePurpose,
        expiresMinutes: cfg.otpExpiryMinutes,
      });
    } catch (mailErr) {
      const err = new Error("Unable to send verification email. Please try again later.");
      err.code = "EMAIL_SEND_FAILED";
      err.errorCode = "EMAIL_SEND_FAILED";
      err.status = 502;
      throw err;
    }
  }

  return {
    sent: true,
    email_masked: maskEmail(normalizedEmail),
    purpose: safePurpose,
    expires_in: cfg.otpExpiryMinutes * 60,
  };
}

async function verifyEmailOtp({ email, otp, purpose, markEmailVerified = true }) {
  const cfg = getEmailConfig();
  const normalizedEmail = normalizeEmail(email);
  const safePurpose = normalizePurpose(purpose);
  const otpValue = String(otp || "").trim();

  if (!isValidEmail(normalizedEmail)) {
    const err = new Error("Invalid email address");
    err.code = "VALIDATION_ERROR";
    err.errorCode = "INVALID_EMAIL";
    throw err;
  }
  if (!safePurpose) {
    const err = new Error("Invalid OTP purpose");
    err.code = "VALIDATION_ERROR";
    err.errorCode = "INVALID_PURPOSE";
    throw err;
  }
  if (!/^\d{6}$/.test(otpValue)) {
    const err = new Error("Invalid OTP");
    err.code = "INVALID_OTP";
    err.errorCode = "INVALID_OTP";
    throw err;
  }

  const record = await getLatestActiveOtp(normalizedEmail, safePurpose);
  if (!record) {
    const err = new Error("OTP expired or not found. Please request a new OTP.");
    err.code = "OTP_EXPIRED";
    err.errorCode = "OTP_NOT_FOUND";
    throw err;
  }

  if (new Date(record.expires_at) < new Date()) {
    const err = new Error("OTP has expired. Please request a new OTP.");
    err.code = "OTP_EXPIRED";
    err.errorCode = "OTP_EXPIRED";
    throw err;
  }

  if (Number(record.attempts) >= cfg.otpMaxAttempts) {
    const err = new Error("Maximum OTP attempts exceeded. Please request a new OTP.");
    err.code = "OTP_LOCKED";
    err.errorCode = "OTP_MAX_ATTEMPTS";
    throw err;
  }

  await pool.query(
    `UPDATE email_otp_verifications SET attempts = attempts + 1 WHERE id = :id`,
    { id: record.id }
  );

  const matched = safeEqualHash(hashOtp(otpValue), record.otp_hash);
  if (!matched) {
    const err = new Error("Invalid OTP");
    err.code = "INVALID_OTP";
    err.errorCode = "INVALID_OTP";
    throw err;
  }

  await pool.query(
    `UPDATE email_otp_verifications SET verified_at = NOW() WHERE id = :id`,
    { id: record.id }
  );
  await invalidateActiveOtps(normalizedEmail, safePurpose);

  if (markEmailVerified && safePurpose === "EMAIL_VERIFICATION") {
    await pool.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE email = :email`,
      { email: normalizedEmail }
    );
  }

  return {
    verified: true,
    email: normalizedEmail,
    email_masked: maskEmail(normalizedEmail),
    purpose: safePurpose,
    user_id: record.user_id || null,
  };
}

/** Confirm a freshly verified OTP still counts (e.g. register after verify). */
async function assertRecentVerifiedEmailOtp(email, purpose, withinMinutes = 30) {
  const normalizedEmail = normalizeEmail(email);
  const safePurpose = normalizePurpose(purpose);
  const windowMins = Math.min(Math.max(Number(withinMinutes) || 30, 5), 120);

  const [rows] = await pool.query(
    `SELECT id FROM email_otp_verifications
     WHERE email = :email AND purpose = :purpose
       AND verified_at IS NOT NULL
       AND verified_at >= DATE_SUB(NOW(), INTERVAL ${windowMins} MINUTE)
     ORDER BY verified_at DESC
     LIMIT 1`,
    { email: normalizedEmail, purpose: safePurpose }
  );

  if (!rows.length) {
    const err = new Error("Email OTP verification required. Please verify your email OTP first.");
    err.code = "OTP_REQUIRED";
    err.errorCode = "OTP_REQUIRED";
    throw err;
  }
  return true;
}

module.exports = {
  EMAIL_OTP_PURPOSES,
  normalizeEmail,
  normalizePurpose,
  sendEmailOtp,
  verifyEmailOtp,
  assertRecentVerifiedEmailOtp,
  maskEmail,
};
