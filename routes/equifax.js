const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
  health,
  testAuth,
  enroll,
  getEnrollment,
  latestScore,
  scoreHistory,
  requestScore,
  latestReport,
  reportSummary,
  reportDetails,
  monitoringList,
  monitoringAlert,
} = require("../controllers/equifaxController");
const { validateCreditCheckConsent } = require("../middleware/creditCheckConsent");

const router = express.Router();

/** Admin diagnostics */
router.get("/health", authenticate, requireAdmin, health);
router.post("/test/auth", authenticate, requireAdmin, testAuth);

/** User Equifax CES (MoneyTrend JWT only authenticates to MoneyTrend) */
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

module.exports = router;
