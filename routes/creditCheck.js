const express = require("express");
const { authenticate, optionalAuthenticate, requireAdmin } = require("../middleware/auth");
const {
  validateCreditCheckConsent,
  validateBureau,
} = require("../middleware/creditCheckConsent");
const { creditCheckRateLimit } = require("../middleware/creditCheckRateLimit");
const {
  // OTP disabled for now — uncomment when credit-check OTP is required again
  // sendCreditCheckOtp,
  // resendCreditCheckOtp,
  runCheck,
  getMyLatestScore,
  getMyCheckHistory,
  getCheckHistory,
  getCheckDetail,
  runAllChecks,
} = require("../controllers/creditCheckController");

const router = express.Router();

// OTP disabled — no OTP required for CIBIL/credit check currently
// router.post("/send-otp", authenticate, sendCreditCheckOtp);
// router.post("/resend-otp", authenticate, resendCreditCheckOtp);

/**
 * Public user CIBIL endpoints — login NOT required.
 * Optional Bearer token is accepted when present.
 */
router.get("/latest", optionalAuthenticate, getMyLatestScore);
router.get("/", optionalAuthenticate, getMyCheckHistory);

/**
 * Public: run & save CIBIL score (no login).
 * Body: pan, fullName, mobile, dateOfBirth, consent, consent_version
 */
router.post(
  "/",
  optionalAuthenticate,
  validateCreditCheckConsent,
  creditCheckRateLimit,
  (req, res, next) => {
    if (!req.body.bureau) req.body.bureau = "CIBIL";
    return validateBureau(req, res, () => runCheck(req, res, next));
  }
);

/** Authenticated variants / admin */
router.post(
  "/run",
  optionalAuthenticate,
  validateCreditCheckConsent,
  validateBureau,
  creditCheckRateLimit,
  runCheck
);

router.get("/history/:userId", authenticate, getCheckHistory);
router.get("/:id", optionalAuthenticate, getCheckDetail);

router.post(
  "/run-all/:userId",
  authenticate,
  requireAdmin,
  validateCreditCheckConsent,
  runAllChecks
);

module.exports = router;
