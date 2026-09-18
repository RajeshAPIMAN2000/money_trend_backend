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

const router = express.Router();

/** Public demo config (card numbers + OTP) — no auth so bank demo UI can load tips */
router.get("/dummy/config", getConfig);

router.use(authenticate);

router.post("/dummy/create", createPayment);
router.post("/dummy/pay", pay);
router.post("/dummy/verify-otp", verifyOtp);
router.get("/dummy/cibil-unlock", cibilUnlockStatus);
router.get("/dummy/:orderId", getPayment);

module.exports = router;
