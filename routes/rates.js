const express = require("express");
const {
  getRatesTicker,
  listPublicRates,
  getPublicRateById,
} = require("../controllers/rateController");

const router = express.Router();

// Public — no authentication (frontend ticker polling)
router.get("/ticker", getRatesTicker);
router.get("/", listPublicRates);
router.get("/:id", getPublicRateById);

module.exports = router;
