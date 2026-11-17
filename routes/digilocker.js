const express = require("express");
const { authenticate } = require("../middleware/auth");
const { digilockerRateLimit } = require("../middleware/digilockerRateLimit");
const {
  startDigilocker,
  digilockerCallback,
  digilockerStatus,
  digilockerCompleteStub,
  digilockerDocuments,
  digilockerRevoke,
} = require("../controllers/digilockerController");

const router = express.Router();

// OAuth start — authenticated MoneyTrend user
router.post("/start", authenticate, digilockerRateLimit, startDigilocker);

// Provider redirect — no JWT; session bound by state
router.get("/callback", digilockerRateLimit, digilockerCallback);

router.get("/status", authenticate, digilockerRateLimit, digilockerStatus);
router.get("/documents", authenticate, digilockerDocuments);
router.post("/documents", authenticate, digilockerRateLimit, digilockerDocuments);
router.post("/revoke", authenticate, digilockerRateLimit, digilockerRevoke);

// Dev / UAT stub (blocked in production unless DIGILOCKER_STUB=true intentionally)
router.post("/complete-stub", authenticate, digilockerRateLimit, digilockerCompleteStub);

module.exports = router;
