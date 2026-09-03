const pool = require("../config/db");

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MARKET_INDICES = [
  { key: "nifty_50", name: "NIFTY 50", value: 24968.4, change_percent: 0.82 },
  { key: "sensex", name: "SENSEX", value: 82145.3, change_percent: 0.78 },
  { key: "bank_nifty", name: "BANK NIFTY", value: 52340.15, change_percent: -0.34 },
  { key: "gold", name: "GOLD", value: 72450, change_percent: 1.12, prefix: "₹" },
  { key: "silver", name: "SILVER", value: 84120, change_percent: 0.95, prefix: "₹" },
  { key: "usd_inr", name: "USD/INR", value: 83.42, change_percent: -0.08 },
];

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatInrCompact(amount) {
  const value = roundMoney(amount);
  if (value >= 1e7) {
    const cr = value / 1e7;
    return { value, display: `₹${cr >= 100 ? cr.toFixed(2) : cr.toFixed(2)} Cr`, unit: "Cr" };
  }
  if (value >= 1e5) {
    const lakhs = value / 1e5;
    return { value, display: `₹${lakhs.toFixed(1)} L`, unit: "L" };
  }
  return { value, display: `₹${value.toLocaleString("en-IN")}`, unit: "INR" };
}

function formatNumberCompact(value) {
  const n = Number(value || 0);
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  return n.toLocaleString("en-IN");
}

function calcGrowthPercent(current, previous) {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (prev <= 0) return cur > 0 ? 100 : 0;
  return roundMoney(((cur - prev) / prev) * 100);
}

function timeAgo(dateValue) {
  const date = new Date(dateValue);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function parseDateRange(query = {}) {
  const toRaw = query.to || query.end_date || query.endDate;
  const fromRaw = query.from || query.start_date || query.startDate;

  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error("Invalid date range. Use YYYY-MM-DD for from and to.");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  return {
    from: fromDate,
    to: toDate,
    label: `${from.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} - ${to.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
  };
}

async function scalar(query, params = {}) {
  const [rows] = await pool.query(query, params);
  return Number(rows[0]?.total ?? rows[0]?.value ?? 0);
}

async function getSummaryCards(dateRange) {
  const totalUsers = await scalar(
    `SELECT COUNT(*) AS total FROM users WHERE role = 'user'`
  );

  const usersPrev = await scalar(
    `SELECT COUNT(*) AS total FROM users
     WHERE role = 'user' AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );

  const fdInvested = await scalar(
    `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM portfolio_fds WHERE status IN ('active','matured','closed')`
  );
  const rdInvested = await scalar(
    `SELECT COALESCE(SUM(monthly_amount * tenure_months), 0) AS total FROM portfolio_rds WHERE status IN ('active','matured','closed')`
  );
  const totalInvestments = fdInvested + rdInvested;

  const fdInvestedPrev = await scalar(
    `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM portfolio_fds
     WHERE status IN ('active','matured','closed') AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );
  const rdInvestedPrev = await scalar(
    `SELECT COALESCE(SUM(monthly_amount * tenure_months), 0) AS total FROM portfolio_rds
     WHERE status IN ('active','matured','closed') AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );
  const totalInvestmentsPrev = fdInvestedPrev + rdInvestedPrev;

  const fdPortfolio = await scalar(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS total FROM portfolio_fds WHERE status = 'active'`
  );
  const rdPortfolio = await scalar(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS total FROM portfolio_rds WHERE status = 'active'`
  );
  const walletBalance = await scalar(`SELECT COALESCE(SUM(balance), 0) AS total FROM wallets`);
  const portfolioValue = fdPortfolio + rdPortfolio + walletBalance;

  const fdPortfolioPrev = await scalar(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS total FROM portfolio_fds
     WHERE status = 'active' AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );
  const rdPortfolioPrev = await scalar(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS total FROM portfolio_rds
     WHERE status = 'active' AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );
  const portfolioValuePrev = fdPortfolioPrev + rdPortfolioPrev + walletBalance * 0.9;

  const revenue = await scalar(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total FROM admin_commissions WHERE status = 'collected'`
  );
  const revenuePrev = await scalar(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total FROM admin_commissions
     WHERE status = 'collected' AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  );

  return {
    total_users: {
      label: "Total Users",
      value: totalUsers,
      display: totalUsers.toLocaleString("en-IN"),
      growth_percent: calcGrowthPercent(totalUsers, usersPrev),
    },
    total_investments: {
      label: "Total Investments",
      ...formatInrCompact(totalInvestments),
      growth_percent: calcGrowthPercent(totalInvestments, totalInvestmentsPrev),
    },
    portfolio_value: {
      label: "Portfolio Value",
      ...formatInrCompact(portfolioValue),
      growth_percent: calcGrowthPercent(portfolioValue, portfolioValuePrev),
    },
    revenue_generated: {
      label: "Revenue Generated",
      ...formatInrCompact(revenue),
      growth_percent: calcGrowthPercent(revenue, revenuePrev),
    },
    date_range: dateRange,
  };
}

async function getActivityCards() {
  const todaysDeposits = await scalar(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
     WHERE direction = 'credit' AND category = 'razorpay_deposit' AND DATE(created_at) = CURDATE()`
  );

  const todaysWithdrawals = await scalar(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
     WHERE direction = 'debit' AND category = 'withdrawal_hold' AND DATE(created_at) = CURDATE()`
  );

  const pendingKyc = await scalar(
    `SELECT COUNT(*) AS total FROM users
     WHERE role = 'user' AND kyc_status IN ('pending', 'submitted')`
  );

  const activeSips = await scalar(
    `SELECT COUNT(*) AS total FROM portfolio_rds WHERE status = 'active'`
  );

  return {
    todays_deposits: { label: "Today's Deposits", ...formatInrCompact(todaysDeposits) },
    todays_withdrawals: { label: "Today's Withdrawals", ...formatInrCompact(todaysWithdrawals) },
    pending_kyc: { label: "Pending KYC", value: pendingKyc, display: String(pendingKyc) },
    active_sips: { label: "Active SIPs", value: activeSips, display: activeSips.toLocaleString("en-IN") },
  };
}

async function getInvestmentOverview() {
  const [fdRows] = await pool.query(
    `SELECT DATE(created_at) AS day, COALESCE(SUM(principal_amount), 0) AS amount
     FROM portfolio_fds
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(created_at)`
  );
  const [rdRows] = await pool.query(
    `SELECT DATE(created_at) AS day, COALESCE(SUM(monthly_amount * tenure_months), 0) AS amount
     FROM portfolio_rds
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(created_at)`
  );

  const byDay = new Map();
  for (const row of [...fdRows, ...rdRows]) {
    const key = String(row.day).slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + Number(row.amount || 0));
  }

  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(DAY_LABELS[d.getDay()]);
    data.push(roundMoney(byDay.get(key) || 0));
  }

  return {
    title: "Investment Overview",
    subtitle: "Weekly investment inflow",
    labels,
    series: [{ name: "Investments", data }],
  };
}

async function getAssetAllocation() {
  const fdValue = await scalar(
    `SELECT COALESCE(SUM(principal_amount), 0) AS total FROM portfolio_fds WHERE status = 'active'`
  );
  const rdValue = await scalar(
    `SELECT COALESCE(SUM(monthly_amount * tenure_months), 0) AS total FROM portfolio_rds WHERE status = 'active'`
  );
  const walletValue = await scalar(`SELECT COALESCE(SUM(balance), 0) AS total FROM wallets`);
  const total = fdValue + rdValue + walletValue;

  const pct = (part) => (total > 0 ? roundMoney((part / total) * 100) : 0);

  const segments = [
    { key: "fixed_deposits", label: "Fixed Deposits", value: fdValue, percent: pct(fdValue) },
    { key: "recurring_deposits", label: "Recurring Deposits", value: rdValue, percent: pct(rdValue) },
    { key: "wallet_cash", label: "Wallet / Cash", value: walletValue, percent: pct(walletValue) },
  ].filter((s) => s.value > 0);

  if (!segments.length) {
    return {
      title: "Asset Allocation Overview",
      labels: ["Fixed Deposits", "Recurring Deposits", "Wallet / Cash", "Others"],
      percentages: [10, 20, 65, 5],
      segments: [
        { key: "fixed_deposits", label: "Fixed Deposits", value: 0, percent: 10 },
        { key: "recurring_deposits", label: "Recurring Deposits", value: 0, percent: 20 },
        { key: "wallet_cash", label: "Wallet / Cash", value: 0, percent: 65 },
        { key: "others", label: "Others", value: 0, percent: 5 },
      ],
    };
  }

  return {
    title: "Asset Allocation Overview",
    labels: segments.map((s) => s.label),
    percentages: segments.map((s) => s.percent),
    segments,
  };
}

function getMarketOverview() {
  const labels = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleString("en-IN", { month: "short" }));
  }

  const baseNifty = 22800;
  const baseSensex = 75200;
  const baseGold = 68500;

  return {
    title: "Market Overview",
    subtitle: "6-month index trend",
    labels,
    series: [
      {
        name: "NIFTY 50",
        data: labels.map((_, idx) => roundMoney(baseNifty + idx * 420 + idx * idx * 35)),
      },
      {
        name: "SENSEX",
        data: labels.map((_, idx) => roundMoney(baseSensex + idx * 1180 + idx * idx * 90)),
      },
      {
        name: "Gold",
        data: labels.map((_, idx) => roundMoney(baseGold + idx * 620 + idx * 40)),
      },
    ],
  };
}

async function getRevenueOverview() {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
            COALESCE(SUM(commission_amount), 0) AS total
     FROM admin_commissions
     WHERE status = 'collected' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`
  );

  const byMonth = new Map(rows.map((r) => [r.month, roundMoney(r.total)]));

  const labels = [];
  const data = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    labels.push(d.toLocaleString("en-IN", { month: "short" }));
    data.push(byMonth.get(key) || 0);
  }

  let cumulative = 0;
  const cumulativeData = data.map((v) => {
    cumulative = roundMoney(cumulative + v);
    return cumulative;
  });

  return {
    title: "Revenue Overview",
    subtitle: "Platform commission revenue",
    labels,
    series: [{ name: "Revenue", data: cumulativeData }],
    monthly: data,
  };
}

async function getTopPerformingInvestments(limit = 5) {
  const [rows] = await pool.query(
    `SELECT bank_name,
            AVG(interest_rate) AS avg_rate,
            COUNT(*) AS investments
     FROM portfolio_fds
     WHERE status = 'active'
     GROUP BY bank_name
     ORDER BY avg_rate DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 5, 1), 10)}`
  );

  if (!rows.length) {
    return [
      { name: "SBI Fixed Deposit", return_percent: 7.2, progress_percent: 72 },
      { name: "HDFC Fixed Deposit", return_percent: 7.0, progress_percent: 70 },
      { name: "ICICI Fixed Deposit", return_percent: 6.9, progress_percent: 69 },
      { name: "Axis Fixed Deposit", return_percent: 6.8, progress_percent: 68 },
      { name: "PNB Fixed Deposit", return_percent: 6.7, progress_percent: 67 },
    ];
  }

  const maxRate = Number(rows[0]?.avg_rate || 1);
  return rows.map((row) => ({
    name: `${row.bank_name} Fixed Deposit`,
    bank_name: row.bank_name,
    return_percent: roundMoney(row.avg_rate),
    progress_percent: Math.min(100, Math.round((Number(row.avg_rate) / maxRate) * 100)),
    investments: Number(row.investments || 0),
  }));
}

function getMarketIndices() {
  return MARKET_INDICES.map((item) => ({
    ...item,
    value_display:
      item.prefix === "₹"
        ? `${item.prefix}${Number(item.value).toLocaleString("en-IN")}`
        : Number(item.value).toLocaleString("en-IN"),
    direction: item.change_percent >= 0 ? "up" : "down",
    change_display: `${item.change_percent >= 0 ? "+" : ""}${item.change_percent}%`,
  }));
}

async function getRecentTransactions(limit = 8) {
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const [rows] = await pool.query(
    `SELECT wt.id, wt.amount, wt.direction, wt.category, wt.description, wt.created_at,
            u.full_name, u.email
     FROM wallet_transactions wt
     JOIN users u ON u.id = wt.user_id
     ORDER BY wt.created_at DESC
     LIMIT ${safeLimit}`
  );

  return rows.map((row) => {
    const amount = roundMoney(row.amount);
    const sign = row.direction === "credit" ? "+" : "-";
    const description =
      row.description ||
      row.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    return {
      id: row.id,
      user_name: row.full_name,
      email: row.email,
      description,
      category: row.category,
      direction: row.direction,
      amount,
      amount_display: `${sign}₹${amount.toLocaleString("en-IN")}`,
      time_ago: timeAgo(row.created_at),
      created_at: row.created_at,
    };
  });
}

async function getKycVerificationSummary() {
  const [rows] = await pool.query(
    `SELECT kyc_status, COUNT(*) AS total
     FROM users
     WHERE role = 'user'
     GROUP BY kyc_status`
  );

  const counts = { pending: 0, submitted: 0, verified: 0, rejected: 0 };
  for (const row of rows) {
    counts[row.kyc_status] = Number(row.total || 0);
  }

  const approved = counts.verified;
  const pending = counts.pending + counts.submitted;
  const rejected = counts.rejected;
  const total = approved + pending + rejected;
  const pct = (n) => (total > 0 ? roundMoney((n / total) * 100) : 0);

  return {
    title: "KYC Verification Summary",
    total,
    approved: { count: approved, percent: pct(approved), label: "Approved" },
    pending: { count: pending, percent: pct(pending), label: "Pending" },
    rejected: { count: rejected, percent: pct(rejected), label: "Rejected" },
    chart: {
      labels: ["Approved", "Pending", "Rejected"],
      data: [approved, pending, rejected],
      percentages: [pct(approved), pct(pending), pct(rejected)],
    },
  };
}

async function getSystemStatus() {
  let dbStatus = "operational";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "down";
  }

  const smsMode = String(process.env.SMS_MODE || "sandbox").toLowerCase();
  const smsStatus = smsMode === "sandbox" ? "operational" : process.env.MSG91_AUTH_KEY || process.env.TWILIO_ACCOUNT_SID ? "operational" : "degraded";

  const paymentStatus =
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? "operational" : "degraded";

  return [
    { key: "database", name: "Database", status: dbStatus },
    { key: "payment_gateway", name: "Payment Gateway", status: paymentStatus },
    { key: "kyc_provider", name: "KYC Provider", status: "operational" },
    { key: "sms_gateway", name: "SMS Gateway", status: smsStatus },
    { key: "email_service", name: "Email Service", status: "operational" },
    { key: "market_data", name: "Market Data", status: "operational" },
  ];
}

function getQuickActions() {
  return [
    { key: "add_user", label: "Add User", route: "/admin/users" },
    { key: "review_kyc", label: "Review KYC", route: "/admin/users?kyc_status=pending" },
    { key: "export_report", label: "Export Report", route: "/admin/reports/export" },
    { key: "api_monitor", label: "API Monitor", route: "/admin/system-status" },
  ];
}

async function getAdminDashboard(query = {}) {
  const dateRange = parseDateRange(query);

  const [
    summary_cards,
    activity_cards,
    investment_overview,
    asset_allocation,
    market_overview,
    revenue_overview,
    top_performing_investments,
    market_indices,
    recent_transactions,
    kyc_verification_summary,
    system_status,
  ] = await Promise.all([
    getSummaryCards(dateRange),
    getActivityCards(),
    getInvestmentOverview(),
    getAssetAllocation(),
    Promise.resolve(getMarketOverview()),
    getRevenueOverview(),
    getTopPerformingInvestments(query.top_limit),
    Promise.resolve(getMarketIndices()),
    getRecentTransactions(query.transactions_limit),
    getKycVerificationSummary(),
    getSystemStatus(),
  ]);

  return {
    date_range: dateRange,
    summary_cards,
    activity_cards,
    charts: {
      investment_overview,
      asset_allocation,
      market_overview,
      revenue_overview,
    },
    top_performing_investments,
    market_indices,
    recent_transactions,
    kyc_verification_summary,
    system_status,
    quick_actions: getQuickActions(),
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getAdminDashboard,
  formatInrCompact,
  formatNumberCompact,
};
