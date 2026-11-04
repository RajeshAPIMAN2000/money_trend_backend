const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  getWallet,
  canInvest,
  listTransactions,
  createDeposit,
  verifyDeposit,
  upsertBankAccount,
  getBankAccount,
  requestWithdrawal,
  listWithdrawals,
  getTaxReport,
} = require("../controllers/walletController");

const router = express.Router();

router.use(authenticate);

router.get("/", getWallet);
router.get("/can-invest", canInvest);
router.get("/transactions", listTransactions);

router.post("/deposit/create", createDeposit);
router.post("/deposit/verify", verifyDeposit);

router.get("/bank-account", getBankAccount);
router.put("/bank-account", upsertBankAccount);
router.post("/bank-account", upsertBankAccount);

router.post("/withdraw", requestWithdrawal);
router.get("/withdrawals", listWithdrawals);

router.get("/tax-report", getTaxReport);

module.exports = router;
