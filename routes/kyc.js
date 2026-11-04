const express = require("express");
const { authenticate } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const {
  lookupPan,
  submitManualKyc,
  submitDigilockerKyc,
  submitNominee,
} = require("../controllers/kycController");

const router = express.Router();

router.use(authenticate);

router.post("/pan-lookup", lookupPan);

// upload.any() accepts any form-data field names (avoids Multer "Unexpected field")
router.post("/manual", upload.any(), submitManualKyc);
router.post("/digilocker", upload.any(), submitDigilockerKyc);
router.post("/nominee", upload.any(), submitNominee);

module.exports = router;
