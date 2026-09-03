const express = require("express");
const {
  sendRegisterOtp,
  resendRegisterOtp,
  sendLoginOtp,
  resendLoginOtp,
  sendForgotPasswordOtp,
  resendForgotPasswordOtp,
  resetPassword,
  register,
  login,
} = require("../controllers/authController");

const router = express.Router();

router.post("/register/send-otp", sendRegisterOtp);
router.post("/register/resend-otp", resendRegisterOtp);
router.post("/login/send-otp", sendLoginOtp);
router.post("/login/resend-otp", resendLoginOtp);
router.post("/forgot-password/send-otp", sendForgotPasswordOtp);
router.post("/forgot-password/resend-otp", resendForgotPasswordOtp);
router.post("/forgot-password/reset", resetPassword);
router.post("/register", register);
router.post("/login", login);

module.exports = router;
