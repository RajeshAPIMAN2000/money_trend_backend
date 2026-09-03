const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../config/db");
const { signAccessToken, signRefreshToken } = require("../utils/jwt");
const { isValidEmail, isValidPhone, parseDob } = require("../utils/validators");
const { sendOtp, resendOtp, verifyOtp, normalizePhone, maskPhone } = require("../services/otpService");

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
    `SELECT id, phone, role, date_of_birth FROM users WHERE email = :email AND phone = :phone LIMIT 1`,
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
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const [rows] = await pool.query(
      `SELECT id, phone, password_hash, role FROM users WHERE email = :email LIMIT 1`,
      { email }
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = rows[0];
    if (user.role === "admin") {
      return res.status(403).json({ success: false, message: "Please use admin login endpoint" });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const data = await sendOtp(user.phone, "login");
    return res.json({
      success: true,
      message: "OTP sent to your registered phone number",
      data: {
        ...data,
        email,
        phone_masked: maskPhone(user.phone),
      },
    });
  } catch (error) {
    return handleOtpError(res, error, "Failed to send login OTP");
  }
}

async function resendLoginOtp(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const [rows] = await pool.query(
      `SELECT id, phone, password_hash, role FROM users WHERE email = :email LIMIT 1`,
      { email }
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = rows[0];
    if (user.role === "admin") {
      return res.status(403).json({ success: false, message: "Please use admin login endpoint" });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const data = await resendOtp(user.phone, "login");
    return res.json({
      success: true,
      message: "Login OTP resent to your registered phone number",
      data: {
        ...data,
        email,
        phone_masked: maskPhone(user.phone),
      },
    });
  } catch (error) {
    return handleOtpError(res, error, "Failed to resend login OTP");
  }
}

async function sendForgotPasswordOtp(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const dobParsed = parseDateOfBirth(req.body);

    if (!email || !phone || !dobParsed) {
      return res.status(400).json({
        success: false,
        message: "Email, phone number and date of birth are required",
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

    const user = await findUserForForgotPassword(email, phone, dobParsed.iso);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with the provided email, phone and date of birth",
      });
    }

    const data = await sendOtp(user.phone, "forgot_password");
    return res.json({
      success: true,
      message: "Password reset OTP sent to your phone number",
      data: {
        ...data,
        email,
        phone_masked: maskPhone(user.phone),
      },
    });
  } catch (error) {
    return handleOtpError(res, error, "Failed to send password reset OTP");
  }
}

async function resendForgotPasswordOtp(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const dobParsed = parseDateOfBirth(req.body);

    if (!email || !phone || !dobParsed) {
      return res.status(400).json({
        success: false,
        message: "Email, phone number and date of birth are required",
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

    const user = await findUserForForgotPassword(email, phone, dobParsed.iso);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with the provided email, phone and date of birth",
      });
    }

    const data = await resendOtp(user.phone, "forgot_password");
    return res.json({
      success: true,
      message: "Password reset OTP resent to your phone number",
      data: {
        ...data,
        email,
        phone_masked: maskPhone(user.phone),
      },
    });
  } catch (error) {
    return handleOtpError(res, error, "Failed to resend password reset OTP");
  }
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
      await verifyOtp(user.phone, "forgot_password", otp);
    } catch (otpError) {
      const status =
        otpError.code === "INVALID_OTP" || otpError.code === "OTP_EXPIRED" || otpError.code === "OTP_LOCKED"
          ? 400
          : 500;
      return res.status(status).json({ success: false, message: otpError.message });
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
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirm_password || req.body.confirmPassword || "");
    const phone = normalizePhone(req.body.phone || req.body.phone_number || req.body.phoneNumber);
    const otp = String(req.body.otp || "").trim();
    const dobParsed = parseDateOfBirth(req.body);

    if (!fullName || !email || !password || !confirmPassword || !phone || !otp || !dobParsed) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, email, password, confirm password, phone number, date of birth and OTP are required",
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

    const [existing] = await pool.query(
      `SELECT id FROM users WHERE email = :email OR phone = :phone LIMIT 1`,
      { email, phone }
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Email or phone number already registered",
      });
    }

    try {
      await verifyOtp(phone, "register", otp);
    } catch (otpError) {
      const status =
        otpError.code === "INVALID_OTP" || otpError.code === "OTP_EXPIRED" || otpError.code === "OTP_LOCKED"
          ? 400
          : 500;
      return res.status(status).json({ success: false, message: otpError.message });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, phone, date_of_birth, role)
       VALUES (:fullName, :email, :passwordHash, :phone, :dateOfBirth, 'user')`,
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
      error: error.message,
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
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const otp = String(req.body.otp || "").trim();

    if (!email || !password || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email, password and OTP are required",
      });
    }

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, password_hash, kyc_status, profile_image, role
       FROM users WHERE email = :email LIMIT 1`,
      { email }
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = rows[0];
    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Please use admin login endpoint",
      });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    try {
      await verifyOtp(user.phone, "login", otp);
    } catch (otpError) {
      const status =
        otpError.code === "INVALID_OTP" || otpError.code === "OTP_EXPIRED" || otpError.code === "OTP_LOCKED"
          ? 400
          : 500;
      return res.status(status).json({ success: false, message: otpError.message });
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
      error: error.message,
    });
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
};
