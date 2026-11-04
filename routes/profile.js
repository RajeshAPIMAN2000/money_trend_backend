const express = require("express");
const { authenticate } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const {
  getProfile,
  getUserPortfolio,
  updateProfile,
} = require("../controllers/profileController");
const {
  upsertBankAccount,
  getBankAccount,
} = require("../controllers/walletController");

const router = express.Router();

router.use(authenticate);

// User profile
router.get("/", getProfile);

// User portfolio (FD + RD summary)
router.get("/portfolio", getUserPortfolio);

// Bank account for withdrawals (also used at KYC/profile stage)
router.get("/bank-account", getBankAccount);
router.put("/bank-account", upsertBankAccount);
router.post("/bank-account", upsertBankAccount);

// Edit profile by user id
// Editable: full_name, email, phone/mobile, profile_image, nominee details
// Locked: user PAN number, user Aadhaar number
router.put("/:id", upload.single("profile_image"), updateProfile);

module.exports = router;
