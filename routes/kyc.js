const express = require("express");
const { authenticate } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { digilockerRateLimit } = require("../middleware/digilockerRateLimit");
const {
  lookupPan,
  submitManualKyc,
  submitDigilockerKyc,
  submitNominee,
} = require("../controllers/kycController");
const {
  startDigilocker,
  digilockerCallback,
  digilockerStatus,
  digilockerCompleteStub,
  digilockerDocuments,
  digilockerRevoke,
} = require("../controllers/digilockerController");

const router = express.Router();

/**
 * DigiLocker OAuth aliases for Fintech client.
 * Callback has no JWT — DigiLocker (or browser) redirects with code+state.
 * Frontend may also call callback with Accept: application/json / ?format=json.
 */
router.get("/digilocker/callback", digilockerRateLimit, digilockerCallback);

router.use(authenticate);

router.post("/pan-lookup", lookupPan);

router.post("/manual", upload.any(), submitManualKyc);
// Legacy multipart DigiLocker body submit (manual fields + digilocker_ref) — preserved
router.post("/digilocker", upload.any(), submitDigilockerKyc);
router.post("/nominee", upload.any(), submitNominee);

// OAuth DigiLocker flow (aliases of /api/digilocker/*)
router.post("/digilocker/init", digilockerRateLimit, startDigilocker);
router.post("/digilocker/start", digilockerRateLimit, startDigilocker);
router.post("/digilocker/complete-stub", digilockerRateLimit, digilockerCompleteStub);
router.get("/digilocker/status", digilockerRateLimit, digilockerStatus);
router.get("/digilocker/documents", digilockerDocuments);
router.post("/digilocker/documents", digilockerRateLimit, digilockerDocuments);
router.post("/digilocker/revoke", digilockerRateLimit, digilockerRevoke);

module.exports = router;
