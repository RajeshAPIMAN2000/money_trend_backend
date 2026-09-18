const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../config/db");
const { signAccessToken, signRefreshToken } = require("../utils/jwt");
const { isValidEmail, isValidPhone, parseDob } = require("../utils/validators");
const { sendOtp, resendOtp, verifyOtp, normalizePhone, maskPhone } = require("../services/otpService");
const {
  EMAIL_OTP_PURPOSES,
  sendEmailOtp,
  verifyEmailOtp,
  assertRecentVerifiedEmailOtp,
  normalizeEmail,
} = require("../services/emailOtpService");
const { sendKycReminderEmail, sendWelcomeEmail } = require("../services/emailService");

function handleEmailOtpError(res, error, fallbackMessage) {
  const status =
    error.status ||
    (error.code === "VALIDATION_ERROR"
      ? 400
      : error.code === "RATE_LIMITED" || error.code === "COOLDOWN"
        ? 429
        : error.code === "INVALID_OTP" ||
            error.code === "OTP_EXPIRED" ||
            error.code === "OTP_LOCKED" ||
            error.code === "OTP_REQUIRED"
          ? 400
          : error.code === "EMAIL_SEND_FAILED"
            ? 502
            : 500);

  return res.status(status).json({
    success: false,
    message: error.message || fallbackMessage,
    errorCode: error.errorCode || error.code || "EMAIL_OTP_ERROR",
    ...(error.retryAfter ? { data: { retry_after: error.retryAfter } } : {}),
  });
}

function buildKycPayload(kycStatus) {
  const status = kycStatus || "pending";

  if (status === "pending") {
    return {
      status: "pending",
      completed: false,
      message: "KYC not completed. Complete it.",
    };
  }

  if (status === "submitted") {
    return {
      status: "submitted",
      completed: false,
      message: "KYC submitted. Complete nominee details.",
    };
  }

  if (status === "verified") {
    return {
      status: "verified",
      completed: true,
      message: "KYC completed.",
    };
  }

  return {
    status,
    completed: false,
    message: "KYC rejected. Complete it again.",
  };
}

async function storeRefreshToken(userId, refreshToken) {
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (:userId, :tokenHash, :expiresAt)`,
    { userId, tokenHash, expiresAt }
  );
}

function issueTokens(user, res) {
  const payload = { sub: user.id, email: user.email, role: user.role || "user" };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { accessToken, refreshToken };
}

function handleOtpError(res, error, fallback) {
  if (error.code === "VALIDATION_ERROR") {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.code === "RATE_LIMITED") {
    return res.status(429).json({ success: false, message: error.message });
  }
  if (error.code === "COOLDOWN") {
    return res.status(429).json({
      success: false,
      message: error.message,
      retry_after: error.retryAfter,
    });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

function parseDateOfBirth(body) {
  return parseDob(body.dob || body.date_of_birth || body.dateOfBirth);
}

async function findUserForForgotPassword(email, phone, dobIso) {
  const [rows] = await pool.query(
    `SELECT id, email, full_name, phone, role, date_of_birth FROM users WHERE email = :email AND phone = :phone LIMIT 1`,
    { email, phone }
  );

  if (!rows.length) return null;

  const user = rows[0];
  if (user.role === "admin") return null;
  if (!user.date_of_birth) return null;

  const storedDob = String(user.date_of_birth).slice(0, 10);
  if (storedDob !== dobIso) return null;

  return user;
}

async function sendRegisterOtp(req, res) {
  try {
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit Indian mobile number",
      });
    }

    const [existing] = await pool.query(`SELECT id FROM users WHERE phone = :phone LIMIT 1`, { phone });
    if (existing.length) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }

    const data = await sendOtp(phone, "register");
    return res.json({ success: true, message: "OTP sent for registration", data });
  } catch (error) {
    return handleOtpError(res, error, "Failed to send registration OTP");
  }
}

async function resendRegisterOtp(req, res) {
  try {
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit Indian mobile number",
      });
    }

    const [existing] = await pool.query(`SELECT id FROM users WHERE phone = :phone LIMIT 1`, { phone });
    if (existing.length) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }

    const data = await resendOtp(phone, "register");
    return res.json({ success: true, message: "Registration OTP resent", data });
  } catch (error) {
    return handleOtpError(res, error, "Failed to resend registration OTP");
  }
}

async function sendLoginOtp(req, res) {
  try {
    return await sendLoginOtpFlow(req, res);
  } catch (error) {
    return handleEmailOtpError(res, error, "Failed to send login OTP");
  }
}

async function resendLoginOtp(req, res) {
  try {
    return await sendLoginOtpFlow(req, res);
  } catch (error) {
    return handleEmailOtpError(res, error, "Failed to resend login OTP");
  }
}

async function sendForgotPasswordOtp(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const dobParsed = parseDateOfBirth(req.body);

    if (!email || !phone || !dobParsed) {
      return res.status(400).json({
        success: false,
        message: "Email, phone number and date of birth are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address", errorCode: "INVALID_EMAIL" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit Indian mobile number",
        errorCode: "INVALID_PHONE",
      });
    }

    const user = await findUserForForgotPassword(email, phone, dobParsed.iso);
    // Enumeration-safe generic response
    if (!user) {
      return res.json({
        success: true,
        message: "If the account details are valid, a verification code has been sent.",
        data: { purpose: "PASSWORD_RESET" },
      });
    }

    const data = await sendEmailOtp({
      email: user.email,
      purpose: "PASSWORD_RESET",
      userId: user.id,
      firstName: String(user.full_name || "").split(/\s+/)[0] || null,
      ipAddress: req.ip,
      requireExistingUser: true,
    });

    return res.json({
      success: true,
      message: "If the account details are valid, a verification code has been sent.",
      data,
    });
  } catch (error) {
    return handleEmailOtpError(res, error, "Failed to send password reset OTP");
  }
}

async function resendForgotPasswordOtp(req, res) {
  return sendForgotPasswordOtp(req, res);
}

async function resetPassword(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const dobParsed = parseDateOfBirth(req.body);
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.password || req.body.new_password || req.body.newPassword || "");
    const confirmPassword = String(
      req.body.confirm_password || req.body.confirmPassword || req.body.confirm_new_password || ""
    );

    if (!email || !phone || !dobParsed || !otp || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Email, phone, date of birth, OTP, new password and confirm password are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit Indian mobile number",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and confirm password do not match",
      });
    }

    const user = await findUserForForgotPassword(email, phone, dobParsed.iso);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with the provided email, phone and date of birth",
      });
    }

    try {
      await verifyEmailOtp({
        email,
        otp,
        purpose: "PASSWORD_RESET",
        markEmailVerified: false,
      });
    } catch (otpError) {
      return handleEmailOtpError(res, otpError, "OTP verification failed");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash = :passwordHash, updated_at = NOW() WHERE id = :id`, {
      id: user.id,
      passwordHash,
    });
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = :userId`, { userId: user.id });

    return res.json({
      success: true,
      message: "Password reset successful. Please login with your new password.",
      data: { email, phone_masked: maskPhone(user.phone) },
    });
  } catch (error) {
    console.error("[AUTH] reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: error.message,
    });
  }
}

async function register(req, res) {
  console.log("[AUTH] register body:", {
    ...req.body,
    password: req.body?.password ? "***" : undefined,
    confirm_password: req.body?.confirm_password || req.body?.confirmPassword ? "***" : undefined,
    otp: req.body?.otp ? "***" : undefined,
  });
  try {
    const fullName = String(req.body.full_name || req.body.fullName || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirm_password || req.body.confirmPassword || "");
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const otp = String(req.body.otp || "").trim();
    const dobParsed = parseDateOfBirth(req.body);

    if (!fullName || !email || !password || !confirmPassword || !phone || !dobParsed) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, email, password, confirm password, phone number and date of birth are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address", errorCode: "INVALID_EMAIL" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit Indian mobile number",
        errorCode: "INVALID_PHONE",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
        errorCode: "VALIDATION_ERROR",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and confirm password do not match",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const [existing] = await pool.query(
      `SELECT id FROM users WHERE email = :email OR phone = :phone LIMIT 1`,
      { email, phone }
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Email or phone number already registered",
        errorCode: "ALREADY_REGISTERED",
      });
    }

    // Email OTP required: either otp in body, or recently verified via /verify-email-otp
    try {
      if (otp) {
        await verifyEmailOtp({
          email,
          otp,
          purpose: "EMAIL_VERIFICATION",
          markEmailVerified: false,
        });
      } else {
        await assertRecentVerifiedEmailOtp(email, "EMAIL_VERIFICATION", 30);
      }
    } catch (otpError) {
      return handleEmailOtpError(res, otpError, "Email OTP verification required");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, phone, date_of_birth, role, email_verified_at)
       VALUES (:fullName, :email, :passwordHash, :phone, :dateOfBirth, 'user', NOW())`,
      { fullName, email, passwordHash, phone, dateOfBirth: dobParsed.iso }
    );

    const user = { id: result.insertId, email, full_name: fullName, phone, role: "user" };
    const tokens = issueTokens(user, res);
    await storeRefreshToken(user.id, tokens.refreshToken);

    try {
      const { ensureWallet } = require("../services/walletService");
      await ensureWallet(user.id);
    } catch (walletErr) {
      console.error("[AUTH] wallet create on register:", walletErr.message);
    }

    try {
      await sendWelcomeEmail({
        to: email,
        firstName: fullName.split(/\s+/)[0] || fullName,
        email,
        registeredAt: new Date(),
      });
    } catch (mailErr) {
      console.error("[AUTH] welcome email failed:", mailErr.code || mailErr.message);
    }

    try {
      await sendKycReminderEmail({
        to: email,
        firstName: fullName.split(/\s+/)[0] || null,
      });
    } catch (mailErr) {
      console.error("[AUTH] KYC reminder email failed:", mailErr.code || mailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful. Please complete KYC.",
      data: {
        user: {
          id: user.id,
          full_name: fullName,
          email,
          phone,
          date_of_birth: dobParsed.iso,
          role: "user",
          email_verified: true,
          kyc_status: "pending",
        },
        kyc: buildKycPayload("pending"),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        next_step: "kyc",
      },
    });
  } catch (error) {
    console.error("[AUTH] register error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
      errorCode: "REGISTER_FAILED",
    });
  }
}

async function login(req, res) {
  console.log("[AUTH] login body:", {
    email: req.body?.email,
    password: req.body?.password ? "***" : undefined,
    otp: req.body?.otp ? "***" : undefined,
  });
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const otp = String(req.body.otp || "").trim();

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, password_hash, kyc_status, profile_image, role, email_verified_at
       FROM users WHERE email = :email LIMIT 1`,
      { email }
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid email or password", errorCode: "INVALID_CREDENTIALS" });
    }

    const user = rows[0];
    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Please use admin login endpoint",
        errorCode: "ADMIN_LOGIN_REQUIRED",
      });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid email or password", errorCode: "INVALID_CREDENTIALS" });
    }

    const requireLoginOtp = String(process.env.EMAIL_OTP_LOGIN_REQUIRED || "true").toLowerCase() !== "false";
    if (requireLoginOtp) {
      try {
        if (otp) {
          await verifyEmailOtp({
            email: user.email,
            otp,
            purpose: "LOGIN_VERIFICATION",
            markEmailVerified: false,
          });
        } else {
          await assertRecentVerifiedEmailOtp(user.email, "LOGIN_VERIFICATION", 10);
        }
      } catch (otpError) {
        return handleEmailOtpError(res, otpError, "Login email OTP verification required");
      }
    }

    const tokens = issueTokens(user, res);
    await storeRefreshToken(user.id, tokens.refreshToken);

    const kyc = buildKycPayload(user.kyc_status);
    let nextStep = "kyc";
    if (user.kyc_status === "submitted") nextStep = "nominee";
    if (user.kyc_status === "verified") nextStep = "profile";

    return res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          role: user.role || "user",
          email_verified: Boolean(user.email_verified_at),
          kyc_status: user.kyc_status,
          profile_image: user.profile_image,
        },
        kyc,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        next_step: nextStep,
      },
    });
  } catch (error) {
    console.error("[AUTH] login error:", error);
    return res.status(500).json({
      success: false,
      message: "Login failed",
      errorCode: "LOGIN_FAILED",
    });
  }
}

/**
 * Shared login OTP sender.
 * Used by /send-email-otp (when purpose=login or password is present) and /send-login-otp.
 */
async function sendLoginOtpFlow(req, res) {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const firstName = req.body.first_name || req.body.firstName || null;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required to send login OTP",
      errorCode: "VALIDATION_ERROR",
    });
  }

  const [rows] = await pool.query(
    `SELECT id, full_name, email, password_hash, role FROM users WHERE email = :email LIMIT 1`,
    { email }
  );
  if (!rows.length || rows[0].role === "admin") {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
      errorCode: "INVALID_CREDENTIALS",
      data: { sent: false, purpose: "LOGIN_VERIFICATION" },
    });
  }

  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
      errorCode: "INVALID_CREDENTIALS",
      data: { sent: false, purpose: "LOGIN_VERIFICATION" },
    });
  }

  const data = await sendEmailOtp({
    email: rows[0].email,
    purpose: "LOGIN_VERIFICATION",
    userId: rows[0].id,
    firstName: firstName || String(rows[0].full_name || "").split(/\s+/)[0] || null,
    ipAddress: req.ip,
    requireExistingUser: true,
  });

  if (!data.sent) {
    return res.status(429).json({
      success: false,
      message: "Login OTP could not be sent right now. Please wait and try again.",
      errorCode: "OTP_NOT_SENT",
      data,
    });
  }

  console.log("[AUTH] login OTP email queued/sent", {
    email_masked: data.email_masked,
    purpose: data.purpose,
  });

  return res.json({
    success: true,
    message: "Login verification code sent to your email",
    data: {
      ...data,
      sent: true,
      next_step: "Enter OTP and call POST /api/auth/login with email, password and otp",
    },
  });
}

/** POST /auth/send-email-otp */
async function sendEmailOtpHandler(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const purpose = req.body.purpose || "EMAIL_VERIFICATION";
    const firstName = req.body.first_name || req.body.firstName || null;
    const password = String(req.body.password || "");

    const safePurpose = String(purpose).toUpperCase().replace(/\s+/g, "_");
    const purposeLooksLikeLogin =
      safePurpose === "LOGIN_VERIFICATION" || String(purpose).toLowerCase() === "login";
    const purposeLooksLikeRegister =
      safePurpose === "EMAIL_VERIFICATION" || String(purpose).toLowerCase() === "register";

    // Frontend login bug: often sends EMAIL_VERIFICATION. If the email already
    // belongs to a user, treat as login OTP (password required).
    let treatAsLogin = purposeLooksLikeLogin;
    if (!treatAsLogin && purposeLooksLikeRegister && email) {
      const [existing] = await pool.query(
        `SELECT id FROM users WHERE email = :email LIMIT 1`,
        { email }
      );
      if (existing.length) {
        if (!password) {
          return res.status(400).json({
            success: false,
            message:
              "This email is already registered. For login OTP send purpose LOGIN_VERIFICATION with email and password.",
            errorCode: "USE_LOGIN_OTP",
            data: {
              sent: false,
              purpose_required: "LOGIN_VERIFICATION",
              endpoint_hint: "POST /api/auth/send-login-otp",
            },
          });
        }
        console.log(
          "[AUTH] remapping EMAIL_VERIFICATION → LOGIN_VERIFICATION (existing user + password)"
        );
        treatAsLogin = true;
      }
    }

    if (treatAsLogin) {
      return await sendLoginOtpFlow(req, res);
    }

    const requireExistingUser =
      ["LOGIN_VERIFICATION", "PASSWORD_RESET", "CHANGE_EMAIL", "TRANSACTION_VERIFICATION"].includes(
        safePurpose
      ) || ["login", "forgot_password", "password_reset"].includes(String(purpose).toLowerCase());
    const requireMissingUser =
      purposeLooksLikeRegister;

    const data = await sendEmailOtp({
      email,
      purpose,
      firstName,
      ipAddress: req.ip,
      requireExistingUser,
      requireMissingUser: requireMissingUser && !requireExistingUser,
    });

    return res.json({
      success: true,
      message: "If the email is eligible for verification, a verification code has been sent.",
      data,
    });
  } catch (error) {
    return handleEmailOtpError(res, error, "Failed to send email OTP");
  }
}

/** POST /auth/verify-email-otp */
async function verifyEmailOtpHandler(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    const purpose = req.body.purpose || "EMAIL_VERIFICATION";

    const result = await verifyEmailOtp({
      email,
      otp,
      purpose,
      markEmailVerified: true,
    });

    const message =
      result.purpose === "EMAIL_VERIFICATION"
        ? "Email verified successfully."
        : "OTP verified successfully.";

    return res.json({
      success: true,
      message,
      data: {
        email_masked: result.email_masked,
        purpose: result.purpose,
        verified: true,
      },
    });
  } catch (error) {
    return handleEmailOtpError(res, error, "Failed to verify email OTP");
  }
}

module.exports = {
  sendRegisterOtp,
  resendRegisterOtp,
  sendLoginOtp,
  resendLoginOtp,
  sendForgotPasswordOtp,
  resendForgotPasswordOtp,
  resetPassword,
  register,
  login,
  sendEmailOtpHandler,
  verifyEmailOtpHandler,
  EMAIL_OTP_PURPOSES,
};
