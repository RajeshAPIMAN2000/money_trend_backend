const express = require("express");
const {
  sendForgotPasswordOtp,
  resendForgotPasswordOtp,
  resetPassword,
  register,
  login,
  sendLoginOtp,
  resendLoginOtp,
  sendEmailOtpHandler,
  verifyEmailOtpHandler,
} = require("../controllers/authController");
const { emailOtpIpRateLimit } = require("../middleware/emailOtpRateLimit");

const router = express.Router();

/** Secure Email OTP (Resend/SMTP abstraction) */
router.post("/send-email-otp", emailOtpIpRateLimit, sendEmailOtpHandler);
router.post("/verify-email-otp", emailOtpIpRateLimit, verifyEmailOtpHandler);

/** Login email OTP (preferred for login screen) */
router.post("/send-login-otp", emailOtpIpRateLimit, sendLoginOtp);
router.post("/resend-login-otp", emailOtpIpRateLimit, resendLoginOtp);

router.post("/forgot-password/send-otp", emailOtpIpRateLimit, sendForgotPasswordOtp);
router.post("/forgot-password/resend-otp", emailOtpIpRateLimit, resendForgotPasswordOtp);
router.post("/forgot-password/reset", resetPassword);
router.post("/register", register);
router.post("/login", login);

module.exports = router;
