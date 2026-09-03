const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
  validateCreditCheckConsent,
  validateBureau,
} = require("../middleware/creditCheckConsent");
const { creditCheckRateLimit } = require("../middleware/creditCheckRateLimit");
const {
  runCheck,
  getCheckHistory,
  getCheckDetail,
  runAllChecks,
} = require("../controllers/creditCheckController");

const router = express.Router();

router.use(authenticate);

router.post(
  "/run",
  validateCreditCheckConsent,
  validateBureau,
  creditCheckRateLimit,
  runCheck
);

router.get("/history/:userId", getCheckHistory);
router.get("/:id", getCheckDetail);

router.post(
  "/run-all/:userId",
  requireAdmin,
  validateCreditCheckConsent,
  runAllChecks
);

module.exports = router;
