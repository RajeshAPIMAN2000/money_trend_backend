const express = require("express");
const { authenticate, requireAdmin, requireStaff } = require("../middleware/auth");
const {
  demoConfig,
  demoWalletSummary,
  demoWalletTransactions,
  demoAddMoney,
  demoProducts,
  demoEstimateFd,
  demoEstimateRd,
  demoCreateFd,
  demoCreateRd,
  demoListInvestments,
  demoGetInvestment,
  demoCreateWithdrawal,
  demoListWithdrawals,
  adminMatureFd,
  adminMatureRd,
  adminSimulateRdInstallment,
  adminDemoOverview,
} = require("../controllers/demoController");

const router = express.Router();

// Public demo config (no secrets)
router.get("/config", demoConfig);
router.get("/products", demoProducts);

router.use(authenticate);

router.get("/wallet", demoWalletSummary);
router.get("/wallet/transactions", demoWalletTransactions);
router.post("/wallet/add-money", demoAddMoney);

router.post("/fd/estimate", demoEstimateFd);
router.post("/rd/estimate", demoEstimateRd);
router.post("/fd", demoCreateFd);
router.post("/rd", demoCreateRd);

router.get("/investments", demoListInvestments);
router.get("/investments/:type/:id", demoGetInvestment);

router.post("/withdrawals", demoCreateWithdrawal);
router.get("/withdrawals", demoListWithdrawals);

// Admin UAT controls
router.get("/admin/overview", requireStaff, requireAdmin, adminDemoOverview);
router.post("/admin/fd/:id/mature", requireStaff, requireAdmin, adminMatureFd);
router.post("/admin/rd/:id/mature", requireStaff, requireAdmin, adminMatureRd);
router.post(
  "/admin/rd/:id/simulate-installment",
  requireStaff,
  requireAdmin,
  adminSimulateRdInstallment
);

module.exports = router;
