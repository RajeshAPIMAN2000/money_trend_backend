const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
  adminLogin,
  getDashboard,
  listExports,
  downloadExport,
  listAdminFixedDeposits,
  getAdminFixedDepositById,
  listAdminRecurringDeposits,
  getAdminRecurringDepositById,
  listAdminPortfolios,
  getAdminPortfolioByUserId,
  listAdminDeposits,
  getAdminDepositById,
  getAdminUserDepositSummary,
  getAdminWithdrawalById,
  listAdminOrders,
  getAdminOrderById,
  listAdminTransactionHistory,
  getAdminTransactionById,
  getAdminFundPerformance,
  getAdminFundPerformanceByBankId,
  getAdminFdAssetAllocation,
  getAdminRdAssetAllocation,
  getAdminAssetAllocation,
  listUsers,
  getUserById,
  updateUserKycStatus,
  listWithdrawals,
  processWithdrawal,
  getUserBankAccountAdmin,
  listCommissions,
} = require("../controllers/adminController");
const {
  adminListRates,
  adminCreateRate,
  adminUpdateRate,
  adminPatchRateStatus,
  adminDeleteRate,
  adminSyncRates,
} = require("../controllers/rateController");
const {
  adminListBlogs,
  adminGetBlog,
  adminCreateBlog,
  adminUpdateBlog,
  adminDeleteBlog,
  adminListNews,
  adminGetNews,
  adminCreateNews,
  adminUpdateNews,
  adminDeleteNews,
} = require("../controllers/articleController");
const {
  adminListBanners,
  adminGetBanner,
  adminCreateBanner,
  adminUpdateBanner,
  adminDeleteBanner,
} = require("../controllers/bannerController");
const { upload } = require("../middleware/upload");

const router = express.Router();

router.post("/login", adminLogin);

router.use(authenticate, requireAdmin);

router.get("/dashboard", getDashboard);

router.get("/exports/types", listExports);
router.get("/exports/:type", downloadExport);

router.get("/investments/fixed-deposits", listAdminFixedDeposits);
router.get("/investments/fixed-deposits/:id", getAdminFixedDepositById);
router.get("/investments/recurring-deposits", listAdminRecurringDeposits);
router.get("/investments/recurring-deposits/:id", getAdminRecurringDepositById);
router.get("/investments/portfolio", listAdminPortfolios);
router.get("/investments/portfolio/users/:userId", getAdminPortfolioByUserId);
router.get("/investments/deposits", listAdminDeposits);
router.get("/investments/deposits/users/:userId", getAdminUserDepositSummary);
router.get("/investments/deposits/:id", getAdminDepositById);
router.get("/investments/withdrawals/:id", getAdminWithdrawalById);
router.get("/investments/orders", listAdminOrders);
router.get("/investments/orders/:id", getAdminOrderById);
router.get("/investments/transactions", listAdminTransactionHistory);
router.get("/investments/transactions/:id", getAdminTransactionById);
router.get("/investments/fund-performance/banks/:bankId", getAdminFundPerformanceByBankId);
router.get("/investments/fund-performance", getAdminFundPerformance);
router.get("/investments/asset-allocation/fd", getAdminFdAssetAllocation);
router.get("/investments/asset-allocation/rd", getAdminRdAssetAllocation);
router.get("/investments/asset-allocation", getAdminAssetAllocation);

router.get("/users", listUsers);
router.get("/users/:id", getUserById);
router.patch("/users/:id/kyc-status", updateUserKycStatus);

router.get("/users/:id/bank-account", getUserBankAccountAdmin);

router.get("/withdrawals", listWithdrawals);
router.patch("/withdrawals/:id", processWithdrawal);

router.get("/commissions", listCommissions);

router.get("/rates", adminListRates);
router.post("/rates", adminCreateRate);
router.post("/rates/sync", adminSyncRates);
router.put("/rates/:id", adminUpdateRate);
router.patch("/rates/:id/status", adminPatchRateStatus);
router.delete("/rates/:id", adminDeleteRate);

router.get("/blogs", adminListBlogs);
router.get("/blogs/:id", adminGetBlog);
router.post("/blogs", upload.single("image"), adminCreateBlog);
router.put("/blogs/:id", upload.single("image"), adminUpdateBlog);
router.delete("/blogs/:id", adminDeleteBlog);

router.get("/news", adminListNews);
router.get("/news/:id", adminGetNews);
router.post("/news", upload.single("image"), adminCreateNews);
router.put("/news/:id", upload.single("image"), adminUpdateNews);
router.delete("/news/:id", adminDeleteNews);

router.get("/banners", adminListBanners);
router.get("/banners/:id", adminGetBanner);
router.post("/banners", upload.single("image"), adminCreateBanner);
router.put("/banners/:id", upload.single("image"), adminUpdateBanner);
router.delete("/banners/:id", adminDeleteBanner);

module.exports = router;
