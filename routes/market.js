const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  getCurrentRates,
  getRateHistory,
  getRepoHistory,
  listBanks,
  getBankById,
  getBankRates,
  getBankHistory,
  getAllBanksHistoryTrend,
} = require("../controllers/marketController");
const {
  listRds,
  addRd,
  deleteRd,
  getRdSummary,
  breakRd,
} = require("../controllers/portfolioController");

const router = express.Router();

// Public market routes - no user token required
router.get("/banks/history/trend", getAllBanksHistoryTrend);
router.get("/banks", listBanks);
router.get("/banks/:id/rates", getBankRates);
router.get("/banks/:id/history", getBankHistory);
router.get("/banks/:id", getBankById);
router.get("/rates", getCurrentRates);
router.get("/history", getRateHistory);
router.get("/repo-history", getRepoHistory);

// RD portfolio routes (separate from FD) - auth required
router.get("/rd", authenticate, listRds);
router.get("/rd/summary", authenticate, getRdSummary);
router.post("/rd", authenticate, addRd);
router.post("/rd/:id/break", authenticate, breakRd);
router.delete("/rd/:id", authenticate, deleteRd);

module.exports = router;
