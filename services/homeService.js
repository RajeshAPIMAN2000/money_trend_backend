const pool = require("../config/db");
const { getTicker } = require("./fdRdRateService");
const { listMarketBanks, tenureLabelToMonths } = require("./marketBankService");
const { getBalance, ensureWallet } = require("./walletService");
const { getLatestInsights } = require("./articleService");
const { resolveBankLogo } = require("./banks/bankLogos");

const TENURE_OPTIONS = [
  { value: "1_year", label: "1 Year", months: 12 },
  { value: "2_years", label: "2 Years", months: 24 },
  { value: "3_years", label: "3 Years", months: 36 },
  { value: "5_years", label: "5 Years", months: 60 },
];

const PLATFORM_STATS = {
  happy_investors: process.env.PLATFORM_HAPPY_INVESTORS || "10L+",
  financial_products: process.env.PLATFORM_PRODUCTS || "500+",
  trusted_partners: process.env.PLATFORM_PARTNERS || "50+",
  customer_support: "24/7",
};

const OUR_SERVICES = [
  { key: "fd", title: "Fixed Deposits", description: "Secure returns with bank FDs", icon: "fd" },
  { key: "rd", title: "Recurring Deposits", description: "Save monthly, earn interest", icon: "rd" },
  { key: "wallet", title: "Digital Wallet", description: "Deposit & invest instantly", icon: "wallet" },
  { key: "kyc", title: "Quick KYC", description: "Verify once, invest anywhere", icon: "kyc" },
  { key: "tax", title: "Tax Reports", description: "ITR-ready investment records", icon: "tax" },
  { key: "withdraw", title: "Easy Withdrawals", description: "Transfer to your bank account", icon: "withdraw" },
];

function resolveTenureLabel(query = {}) {
  if (query.tenure_label || query.tenureLabel) {
    return String(query.tenure_label || query.tenureLabel);
  }
  const months = Number(query.tenure_months || query.tenureMonths);
  if (months === 6) return "6_months";
  if (months === 12) return "1_year";
  if (months === 24) return "2_years";
  if (months === 36) return "3_years";
  if (months === 60) return "5_years";
  const raw = String(query.tenure || "1_year").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw === "1" || raw === "1year") return "1_year";
  return raw.includes("_") ? raw : `${raw}_years`;
}

function calcFdMaturity(principal, ratePercent, tenureMonths) {
  const P = Number(principal);
  const r = Number(ratePercent) / 100;
  const years = Number(tenureMonths) / 12;
  const maturity = P * Math.pow(1 + r / 4, 4 * years);
  return Math.round(maturity * 100) / 100;
}

function calcRdMaturity(monthlyAmount, ratePercent, tenureMonths) {
  const R = Number(monthlyAmount);
  const i = Number(ratePercent) / 400;
  const n = Number(tenureMonths);
  if (i === 0) return Math.round(R * n * 100) / 100;
  return Math.round(R * ((Math.pow(1 + i, n) - 1) / i) * 100) / 100;
}

async function getFeaturedProducts() {
  const ticker = await getTicker({ limit: 10, category: "regular" });
  const topFd = ticker.fd?.[0]?.interestRate ?? 0;
  const topRd = ticker.rd?.[0]?.interestRate ?? 0;

  return {
    fixed_deposits: {
      title: "Fixed Deposits",
      subtitle: "Secure & guaranteed returns",
      rate_up_to: topFd,
      rate_display: topFd ? `Up to ${topFd}% p.a.` : "Compare rates",
      cta: "Invest Now",
      route: "/fd",
    },
    recurring_deposits: {
      title: "Recurring Deposits",
      subtitle: "Build savings habit",
      rate_up_to: topRd,
      rate_display: topRd ? `Up to ${topRd}% p.a.` : "Compare rates",
      cta: "Invest Now",
      route: "/market/rd",
    },
    mutual_funds: {
      title: "Mutual Funds",
      subtitle: "Market-linked returns",
      rate_display: "Coming Soon",
      coming_soon: true,
      cta: "Explore Funds",
    },
    sip: {
      title: "SIP Investments",
      subtitle: "ELSS — Tax Saving",
      rate_display: "Coming Soon",
      coming_soon: true,
      cta: "Start SIP",
    },
  };
}

async function getCompareInvest(options = {}) {
  const productType = String(options.type || options.productType || "FD").toUpperCase();
  if (!["FD", "RD"].includes(productType)) {
    const err = new Error("type must be FD or RD");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const tenureLabel = resolveTenureLabel(options);
  const tenureMonths = tenureLabelToMonths(tenureLabel);
  const tenureMeta = TENURE_OPTIONS.find((t) => t.value === tenureLabel) || {
    value: tenureLabel,
    label: tenureLabel.replace(/_/g, " "),
    months: tenureMonths,
  };

  const amount = Number(options.amount || options.investment_amount || 100000);
  const limit = Math.min(Number(options.limit) || 4, 20);
  const category = options.category || "regular";

  const [rows] = await pool.query(
    `SELECT r.id AS rate_id, r.interest_rate, r.tenure_label, r.min_deposit, r.max_deposit,
            b.id AS bank_id, b.bank_code, b.bank_name, b.bank_type, b.logo_url
     FROM fd_rd_rates r
     INNER JOIN market_banks b ON b.bank_code = r.bank_code AND b.status = 'active'
     WHERE r.product_type = :productType
       AND r.tenure_label = :tenureLabel
       AND r.customer_category = :category
       AND r.status = 'active'
       AND r.effective_date <= CURDATE()
       AND (r.expiry_date IS NULL OR r.expiry_date >= CURDATE())
       AND (r.min_deposit IS NULL OR r.min_deposit <= :amount)
       AND (r.max_deposit IS NULL OR r.max_deposit >= :amount)
     ORDER BY r.interest_rate DESC
     LIMIT ${limit}`,
    { productType, tenureLabel, category, amount }
  );

  const banks = rows.map((row, index) => {
    const rate = Number(row.interest_rate);
    const maturityAmount =
      productType === "FD"
        ? calcFdMaturity(amount, rate, tenureMonths)
        : calcRdMaturity(amount, rate, tenureMonths);
    const logo = resolveBankLogo({ bankCode: row.bank_code, logoUrl: row.logo_url });

    return {
      rank: index + 1,
      id: row.bank_id,
      bank_id: row.bank_id,
      rate_id: row.rate_id,
      bank_name: row.bank_name,
      bank_code: row.bank_code,
      bank_type: row.bank_type,
      logo,
      logo_url: logo,
      bank_logo: logo,
      icon: logo,
      icon_url: logo,
      interest_rate: rate,
      rate_display: `${rate}% p.a.`,
      investment_amount: amount,
      tenure: tenureMeta.label,
      tenure_label: tenureLabel,
      maturity_amount: maturityAmount,
      interest_earned: Math.round((maturityAmount - amount) * 100) / 100,
      invest_action: productType === "FD" ? "POST /api/fd" : "POST /api/market/rd",
    };
  });

  return {
    product_type: productType,
    tenure: tenureMeta.label,
    tenure_label: tenureLabel,
    tenure_months: tenureMonths,
    tenure_options: TENURE_OPTIONS,
    investment_amount: amount,
    highest_rate: banks[0]?.interest_rate ?? null,
    banks,
    view_all_route: `/api/market/banks`,
  };
}

/** Optional user context when compare is called with a valid token (no auth required). */
async function getCompareUserContext(userId, { amount, productType } = {}) {
  const investAmount = Number(amount) || 0;
  const [users] = await pool.query(
    `SELECT id, full_name, kyc_status FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );
  if (!users.length) return null;

  await ensureWallet(userId);
  const walletBalance = await getBalance(userId);
  const kycVerified = users[0].kyc_status === "verified";
  const canInvest = kycVerified && walletBalance >= investAmount;

  return {
    is_logged_in: true,
    user_id: userId,
    full_name: users[0].full_name,
    kyc_status: users[0].kyc_status,
    kyc_verified: kycVerified,
    wallet_balance: Math.round(walletBalance * 100) / 100,
    investment_amount: investAmount,
    can_invest: canInvest,
    show_invest_buttons: true,
    invest_requires_login: false,
    message: !kycVerified
      ? "Complete KYC to invest"
      : !canInvest
        ? `Add ₹${Math.max(0, investAmount - walletBalance).toLocaleString("en-IN")} to wallet to invest`
        : `Ready to invest in ${productType}`,
    login_required_for_invest: false,
  };
}

async function getPublicHomePayload() {
  const [featuredProducts, compareFd, compareRd, ticker, insights] = await Promise.all([
    getFeaturedProducts(),
    getCompareInvest({ type: "FD", tenure: "1_year", amount: 100000, limit: 4 }),
    getCompareInvest({ type: "RD", tenure: "1_year", amount: 5000, limit: 4 }),
    getTicker({ limit: 8, category: "regular" }),
    getLatestInsights(3),
  ]);

  return {
    featured_products: featuredProducts,
    rate_ticker: ticker,
    compare_invest: {
      default_tenure: "1_year",
      tenure_options: TENURE_OPTIONS,
      fd: compareFd,
      rd: compareRd,
    },
    our_services: OUR_SERVICES,
    platform_stats: PLATFORM_STATS,
    insights: {
      blogs: insights.blogs,
      news: insights.news,
    },
    routes: {
      banks: "/api/market/banks",
      compare: "/api/home/compare",
      ticker: "/api/rates/ticker",
      blogs: "/api/articles/blogs",
      news: "/api/articles/news",
      bank_history: "/api/market/banks/:id/history",
      all_banks_trend: "/api/market/banks/history/trend",
      fd_invest: "/api/fd",
      rd_invest: "/api/market/rd",
      wallet: "/api/wallet",
      portfolio: "/api/profile/portfolio",
    },
  };
}

async function buildNetWorthTrend(userId) {
  const [txs] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, balance_after
     FROM wallet_transactions
     WHERE user_id = :userId
       AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     ORDER BY created_at ASC`,
    { userId }
  );

  const byMonth = new Map();
  for (const tx of txs) {
    byMonth.set(tx.month, Number(tx.balance_after));
  }

  const points = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    points.push({
      month,
      label: d.toLocaleString("en-IN", { month: "short", year: "numeric" }),
      value: byMonth.get(month) ?? null,
    });
  }

  const filled = [...points];
  let lastKnown = 0;
  for (const p of filled) {
    if (p.value != null) lastKnown = p.value;
    else p.value = lastKnown;
  }

  return {
    labels: filled.map((p) => p.label),
    data: filled.map((p) => p.value),
    points: filled,
  };
}

async function getUserDashboard(userId) {
  await ensureWallet(userId);
  const walletBalance = await getBalance(userId);

  const [fds] = await pool.query(
    `SELECT principal_amount, maturity_amount FROM portfolio_fds
     WHERE user_id = :userId AND status = 'active'`,
    { userId }
  );
  const [rds] = await pool.query(
    `SELECT monthly_amount, tenure_months, maturity_amount FROM portfolio_rds
     WHERE user_id = :userId AND status = 'active'`,
    { userId }
  );

  const fdInvested = fds.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
  const fdMaturity = fds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);
  const rdMaturity = rds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);
  const rdInvested = rds.reduce(
    (s, r) => s + Number(r.monthly_amount || 0) * Number(r.tenure_months || 0),
    0
  );

  const debtValue = Math.round((fdMaturity + rdMaturity) * 100) / 100;
  const cashValue = Math.round(walletBalance * 100) / 100;
  const netWorth = Math.round((debtValue + cashValue) * 100) / 100;
  const investedTotal = fdInvested + rdInvested;

  const allocation = [
    { key: "debt", label: "Debt (FD/RD)", percent: netWorth ? Math.round((debtValue / netWorth) * 100) : 0, value: debtValue },
    { key: "cash", label: "Cash (Wallet)", percent: netWorth ? Math.round((cashValue / netWorth) * 100) : 0, value: cashValue },
    { key: "equity", label: "Equity", percent: 0, value: 0 },
    { key: "gold", label: "Gold", percent: 0, value: 0 },
  ];

  const healthScore = Math.min(
    100,
    Math.round(
      (walletBalance > 0 ? 25 : 0) +
        (fds.length > 0 ? 25 : 0) +
        (rds.length > 0 ? 20 : 0) +
        (investedTotal > 50000 ? 20 : investedTotal > 10000 ? 10 : 0) +
        10
    )
  );

  const netWorthTrend = await buildNetWorthTrend(userId);
  const prevValue = netWorthTrend.data[0] || netWorth;
  const changePercent =
    prevValue > 0 ? Math.round(((netWorth - prevValue) / prevValue) * 1000) / 10 : 0;

  return {
    financial_snapshot: {
      net_worth: netWorth,
      net_worth_display: `₹${netWorth.toLocaleString("en-IN")}`,
      change_percent: changePercent,
      change_display: `${changePercent >= 0 ? "+" : ""}${changePercent}%`,
      net_worth_trend: netWorthTrend,
    },
    asset_allocation: allocation,
    financial_health_score: {
      score: healthScore,
      label: healthScore >= 80 ? "Excellent" : healthScore >= 60 ? "Good" : "Fair",
    },
    portfolio_summary: {
      fd_count: fds.length,
      rd_count: rds.length,
      fd_invested: Math.round(fdInvested * 100) / 100,
      rd_invested: Math.round(rdInvested * 100) / 100,
      wallet_balance: cashValue,
    },
    goals: [],
    goals_note: "Goals module can be added later; returns empty list for now",
  };
}

module.exports = {
  TENURE_OPTIONS,
  PLATFORM_STATS,
  OUR_SERVICES,
  resolveTenureLabel,
  getFeaturedProducts,
  getCompareInvest,
  getCompareUserContext,
  getPublicHomePayload,
  getUserDashboard,
};
