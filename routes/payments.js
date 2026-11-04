const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  getConfig,
  createPayment,
  pay,
  verifyOtp,
  getPayment,
  cibilUnlockStatus,
} = require("../controllers/dummyPaymentController");
const {
  createCivilScorePaymentOrder,
  createCivilScoreQrCode,
  getCivilScoreQrPaymentStatus,
  verifyCivilScorePayment,
  getCivilScoreUnlockStatus,
  downloadCivilScoreReport,
  handleCivilScoreWebhook,
} = require("../controllers/civilScorePaymentController");

const router = express.Router();

router.post("/civil-score/webhook", handleCivilScoreWebhook);

/** Public demo config (card numbers + OTP) — no auth so bank demo UI can load tips */
router.get("/dummy/config", getConfig);

router.use(authenticate);

router.post("/dummy/create", createPayment);
router.post("/dummy/pay", pay);
router.post("/dummy/verify-otp", verifyOtp);
router.get("/dummy/cibil-unlock", cibilUnlockStatus);
router.get("/dummy/:orderId", getPayment);

router.post("/civil-score/order", createCivilScorePaymentOrder);
router.post("/civil-score/qr", createCivilScoreQrCode);
router.get("/civil-score/qr/:paymentId/status", getCivilScoreQrPaymentStatus);
router.post("/civil-score/verify", verifyCivilScorePayment);
router.get("/civil-score/status", getCivilScoreUnlockStatus);
router.get("/civil-score/download", downloadCivilScoreReport);

module.exports = router;
