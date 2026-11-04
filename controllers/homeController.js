const {
  getPublicHomePayload,
  getCompareInvest,
  getCompareUserContext,
  getFeaturedProducts,
  getUserDashboard,
} = require("../services/homeService");
const { verifyAccessToken } = require("../utils/jwt");

function tryGetUserId(req) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.accessToken;
    if (!token) return null;
    const decoded = verifyAccessToken(token);
    return decoded.sub;
  } catch (_e) {
    return null;
  }
}

/** GET /home — public (no JWT) */
async function getHome(_req, res) {
  try {
    const data = await getPublicHomePayload();
    return res.json({
      success: true,
      message: "Home page data",
      data: {
        ...data,
        is_logged_in: false,
      },
    });
  } catch (error) {
    console.error("[HOME] getHome error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load home data" });
  }
}

/** GET /home/products — public (no JWT) */
async function getHomeProducts(_req, res) {
  try {
    const data = await getFeaturedProducts();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[HOME] products error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load products" });
  }
}

/** GET /home/compare — public; shows user wallet/KYC/invest status when token is sent */
async function getHomeCompare(req, res) {
  try {
    const amount = req.query.amount || req.query.investment_amount;
    const productType = req.query.type || req.query.productType || "FD";

    const data = await getCompareInvest({
      type: productType,
      tenure: req.query.tenure,
      tenure_label: req.query.tenure_label,
      tenure_months: req.query.tenure_months,
      amount,
      limit: req.query.limit,
      category: req.query.category || "regular",
    });

    const userId = tryGetUserId(req);
    const user = userId
      ? await getCompareUserContext(userId, { amount: data.investment_amount, productType: data.product_type })
      : {
          is_logged_in: false,
          show_invest_buttons: true,
          invest_requires_login: true,
          login_required_for_invest: true,
          message: "Login to invest",
        };

    const banks = data.banks.map((bank) => ({
      ...bank,
      show_invest: user.is_logged_in ? user.can_invest : false,
      invest_label: user.is_logged_in ? (user.can_invest ? "Invest" : "Add Funds") : "Login to Invest",
    }));

    return res.json({
      success: true,
      message: `Compare ${data.product_type} rates`,
      data: {
        ...data,
        banks,
        user,
      },
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[HOME] compare error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to compare rates" });
  }
}

/** GET /home/dashboard — public; returns snapshot only when token is sent */
async function getHomeDashboard(req, res) {
  try {
    const userId = tryGetUserId(req);
    if (!userId) {
      return res.json({
        success: true,
        message: "Login to view your financial snapshot",
        data: {
          is_logged_in: false,
          dashboard: null,
          login_required: true,
        },
      });
    }

    const dashboard = await getUserDashboard(userId);
    return res.json({
      success: true,
      message: "Financial snapshot",
      data: {
        is_logged_in: true,
        dashboard,
      },
    });
  } catch (error) {
    console.error("[HOME] dashboard error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load dashboard" });
  }
}

/** GET /home/full — public; includes dashboard when token is sent */
async function getHomeFull(req, res) {
  try {
    const publicData = await getPublicHomePayload();
    const userId = tryGetUserId(req);

    let compareUser = {
      is_logged_in: false,
      invest_requires_login: true,
      message: "Login to invest",
    };
    let dashboard = null;

    if (userId) {
      compareUser = await getCompareUserContext(userId, {
        amount: publicData.compare_invest?.fd?.investment_amount || 100000,
        productType: "FD",
      });
      dashboard = await getUserDashboard(userId);
    }

    return res.json({
      success: true,
      message: "Full home page data",
      data: {
        ...publicData,
        is_logged_in: Boolean(userId),
        compare_user: compareUser,
        dashboard,
      },
    });
  } catch (error) {
    console.error("[HOME] full error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load home page" });
  }
}

module.exports = {
  getHome,
  getHomeProducts,
  getHomeCompare,
  getHomeDashboard,
  getHomeFull,
};
