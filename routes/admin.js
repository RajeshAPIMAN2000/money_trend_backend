const express = require("express");
const {
  authenticate,
  requireAdmin,
  requireStaff,
  requirePermission,
} = require("../middleware/auth");
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
  listAvailableSubAdminRoles,
  listSubAdmins,
  getSubAdminById,
  createSubAdmin,
  updateSubAdmin,
  deleteSubAdmin,
} = require("../controllers/subAdminController");
const {
  adminGetSeoSettings,
  adminUpdateSeoSettings,
  adminListSeoPages,
  adminUpsertSeoPage,
  adminDeleteSeoPage,
} = require("../controllers/seoController");
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
  listArticleCategories,
} = require("../controllers/articleController");
const {
  adminListBanners,
  adminGetBanner,
  adminCreateBanner,
  adminUpdateBanner,
  adminDeleteBanner,
} = require("../controllers/bannerController");
const {
  adminListCreditChecks,
  adminGetCreditCheck,
  adminGetUserCreditScores,
  adminEquifaxCdsStatus,
} = require("../controllers/creditCheckController");
const {
  adminListTickets,
  adminGetTicket,
  adminUpdateTicketStatus,
} = require("../controllers/supportController");
const { upload } = require("../middleware/upload");

const router = express.Router();

router.post("/login", adminLogin);

// Admin + Sub-admin portal
router.use(authenticate, requireStaff);

// ----- SEO Management (admin or sub-admin with seo role) -----
router.get("/seo/settings", requirePermission("seo"), adminGetSeoSettings);
router.put("/seo/settings", requirePermission("seo"), adminUpdateSeoSettings);
router.patch("/seo/settings", requirePermission("seo"), adminUpdateSeoSettings);
router.get("/seo/pages", requirePermission("seo"), adminListSeoPages);
router.post("/seo/pages", requirePermission("seo"), adminUpsertSeoPage);
router.put("/seo/pages", requirePermission("seo"), adminUpsertSeoPage);
router.put("/seo/pages/:id", requirePermission("seo"), adminUpsertSeoPage);
router.delete("/seo/pages/:id", requirePermission("seo"), adminDeleteSeoPage);

// ----- Blog Management -----
router.get("/article-categories", requirePermission("blog"), listArticleCategories);
router.get("/blogs", requirePermission("blog"), adminListBlogs);
router.get("/blogs/:id", requirePermission("blog"), adminGetBlog);
router.post("/blogs", requirePermission("blog"), upload.single("image"), adminCreateBlog);
router.put("/blogs/:id", requirePermission("blog"), upload.single("image"), adminUpdateBlog);
router.delete("/blogs/:id", requirePermission("blog"), adminDeleteBlog);

// ----- News Management -----
router.get("/news", requirePermission("news"), adminListNews);
router.get("/news/:id", requirePermission("news"), adminGetNews);
router.post("/news", requirePermission("news"), upload.single("image"), adminCreateNews);
router.put("/news/:id", requirePermission("news"), upload.single("image"), adminUpdateNews);
router.delete("/news/:id", requirePermission("news"), adminDeleteNews);

// ----- Full admin only below -----
router.use(requireAdmin);

router.get("/sub-admins/roles", listAvailableSubAdminRoles);
router.get("/sub-admins", listSubAdmins);
router.get("/sub-admins/:id", getSubAdminById);
router.post("/sub-admins", createSubAdmin);
router.put("/sub-admins/:id", updateSubAdmin);
router.patch("/sub-admins/:id", updateSubAdmin);
router.delete("/sub-admins/:id", deleteSubAdmin);

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

router.get("/banners", adminListBanners);
router.get("/banners/:id", adminGetBanner);
router.post("/banners", upload.single("image"), adminCreateBanner);
router.put("/banners/:id", upload.single("image"), adminUpdateBanner);
router.delete("/banners/:id", adminDeleteBanner);

router.get("/credit-checks", adminListCreditChecks);
router.get("/credit-checks/equifax/status", adminEquifaxCdsStatus);
router.post("/credit-checks/equifax/token-test", adminEquifaxCdsStatus);
router.get("/credit-checks/:id", adminGetCreditCheck);
router.get("/users/:id/credit-checks", adminGetUserCreditScores);

router.get("/support", adminListTickets);
router.get("/support/:id", adminGetTicket);
router.patch("/support/:id/status", adminUpdateTicketStatus);
router.put("/support/:id/status", adminUpdateTicketStatus);

module.exports = router;
