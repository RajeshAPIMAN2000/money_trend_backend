const express = require("express");
const {
  // Register/Login OTP disabled for now
  // sendRegisterOtp,
  // resendRegisterOtp,
  // sendLoginOtp,
  // resendLoginOtp,
  sendForgotPasswordOtp,
  resendForgotPasswordOtp,
  resetPassword,
  register,
  login,
} = require("../controllers/authController");

const router = express.Router();

// Register / Login OTP disabled — email+password (and register fields) only
// router.post("/register/send-otp", sendRegisterOtp);
// router.post("/register/resend-otp", resendRegisterOtp);
// router.post("/login/send-otp", sendLoginOtp);
// router.post("/login/resend-otp", resendLoginOtp);

router.post("/forgot-password/send-otp", sendForgotPasswordOtp);
router.post("/forgot-password/resend-otp", resendForgotPasswordOtp);
router.post("/forgot-password/reset", resetPassword);
router.post("/register", register);
router.post("/login", login);

module.exports = router;
