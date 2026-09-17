const express = require("express");
const { authenticate, optionalAuthenticate, requireAdmin } = require("../middleware/auth");
const {
  validateCreditCheckConsent,
  validateBureau,
} = require("../middleware/creditCheckConsent");
const { creditCheckRateLimit } = require("../middleware/creditCheckRateLimit");
const {
  runCheck,
  getMyLatestScore,
  getMyCheckHistory,
  getCheckHistory,
  getCheckDetail,
  downloadCreditReport,
  downloadLatestCreditReports,
  runAllChecks,
} = require("../controllers/creditCheckController");
const {
  enroll,
  getEnrollment,
  requestScore,
  latestScore,
  scoreHistory,
  latestReport,
  reportSummary,
  reportDetails,
  monitoringList,
  monitoringAlert,
} = require("../controllers/equifaxController");

const router = express.Router();

/**
 * Public user CIBIL endpoints — login NOT required.
 * Default CIBIL check stores CIBIL + EXPERIAN + EQUIFAX rows when CIBIL_MULTI_BUREAU=true.
 */
router.get("/latest", optionalAuthenticate, getMyLatestScore);
router.get("/report/latest", optionalAuthenticate, downloadLatestCreditReports);
router.get("/", optionalAuthenticate, getMyCheckHistory);

/** Equifax Consumer Engagement Suite — authenticated MoneyTrend user */
router.post("/enrollment", authenticate, validateCreditCheckConsent, enroll);
router.get("/enrollment", authenticate, getEnrollment);
router.post("/score", authenticate, validateCreditCheckConsent, requestScore);
router.get("/score/latest", authenticate, latestScore);
router.get("/score/history", authenticate, scoreHistory);
router.get("/report", authenticate, latestReport);
router.get("/report/summary", authenticate, reportSummary);
router.get("/report/details", authenticate, reportDetails);
router.get("/monitoring", authenticate, monitoringList);
router.get("/monitoring/:alertId", authenticate, monitoringAlert);

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

router.post(
  "/run",
  optionalAuthenticate,
  validateCreditCheckConsent,
  validateBureau,
  creditCheckRateLimit,
  runCheck
);

router.get("/history/:userId", authenticate, getCheckHistory);
router.get("/:id/report", optionalAuthenticate, downloadCreditReport);
router.get("/:id", optionalAuthenticate, getCheckDetail);

router.post(
  "/run-all/:userId",
  authenticate,
  requireAdmin,
  validateCreditCheckConsent,
  runAllChecks
);

module.exports = router;
