const pool = require("../config/db");
const { ensureWallet, getBalance } = require("./walletService");
const { getLatestScores } = require("./creditCheckService");
const { resolveBankLogo } = require("./banks/bankLogos");

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function withBankLogo(row) {
  const logo = resolveBankLogo({
    bankCode: row.bank_code,
    logoUrl: row.logo_url,
  });
  return {
    ...row,
    logo,
    logo_url: logo,
    bank_logo: logo,
    icon: logo,
    icon_url: logo,
  };
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d) {
  return d.toLocaleString("en-IN", { month: "short" });
}

/** Map wallet categories into UI-friendly bar-chart buckets. */
function mapTxBucket(direction, category) {
  const cat = String(category || "").toLowerCase();
  if (direction === "credit") {
    if (cat.includes("deposit") || cat.includes("salary") || cat === "credit") return "income";
    if (cat.includes("break") || cat.includes("maturity") || cat.includes("settle")) return "income";
    return "income";
  }
  if (cat.includes("fd") || cat.includes("rd") || cat.includes("invest")) return "investment";
  if (cat.includes("withdraw")) return "withdrawal";
  if (cat.includes("fee") || cat.includes("commission")) return "fees";
  return "other";
}

const BAR_SERIES = [
  { key: "income", label: "Income / Credits", color: "#22c55e" },
  { key: "investment", label: "Investments", color: "#3b82f6" },
  { key: "withdrawal", label: "Withdrawals", color: "#f97316" },
  { key: "fees", label: "Fees", color: "#a855f7" },
  { key: "other", label: "Other", color: "#94a3b8" },
];

const PIE_COLORS = {
  fd: "#3b82f6",
  rd: "#22c55e",
  wallet: "#f59e0b",
};

function buildFinancialHealth({ walletBalance, fdInvested, rdInvested, fdCount, rdCount, investedTotal }) {
  const savingsRate = Math.min(
    100,
    Math.round(walletBalance > 0 ? 40 + Math.min(45, (walletBalance / 100000) * 20) : 15)
  );
  const hasBoth = fdCount > 0 && rdCount > 0;
  const hasOne = fdCount > 0 || rdCount > 0;
  const investmentMix = hasBoth ? 85 : hasOne ? 65 : 20;
  // Lower concentration in a single product = healthier "debt load" for deposit portfolio
  const ratio =
    investedTotal > 0 ? Math.max(fdInvested, rdInvested) / investedTotal : 1;
  const debtLoad = Math.min(100, Math.round((1 - Math.abs(ratio - 0.5) * 1.2) * 100));
  const emergencyFund = Math.min(
    100,
    Math.round(walletBalance >= 50000 ? 90 : walletBalance >= 10000 ? 70 : walletBalance > 0 ? 45 : 15)
  );

  const metrics = [
    { key: "savings_rate", label: "Savings Rate", score: savingsRate },
    { key: "investment_mix", label: "Investment Mix", score: investmentMix },
    { key: "debt_load", label: "Debt Load", score: debtLoad },
    { key: "emergency_fund", label: "Emergency Fund", score: emergencyFund },
  ];

  const score = Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length);

  return {
    score,
    max: 100,
    label: score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs attention",
    metrics,
  };
}

async function buildMonthlyBarChart(userId, months = 6) {
  const safeMonths = Math.min(Math.max(Number(months) || 6, 1), 24);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
            direction, category, SUM(amount) AS total
     FROM wallet_transactions
     WHERE user_id = :userId
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${safeMonths} MONTH)
     GROUP BY month, direction, category
     ORDER BY month ASC`,
    { userId }
  );

  const now = new Date();
  const labels = [];
  const monthKeys = [];
  for (let i = safeMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(monthKey(d));
    labels.push(monthLabel(d));
  }

  const buckets = {};
  for (const key of BAR_SERIES.map((s) => s.key)) {
    buckets[key] = Object.fromEntries(monthKeys.map((m) => [m, 0]));
  }

  for (const row of rows) {
    const bucket = mapTxBucket(row.direction, row.category);
    if (!buckets[bucket]) continue;
    if (buckets[bucket][row.month] == null) continue;
    buckets[bucket][row.month] += Number(row.total || 0);
  }

  const series = BAR_SERIES.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    data: monthKeys.map((m) => round2(buckets[s.key][m])),
  }));

  const hasData = series.some((s) => s.data.some((v) => v > 0));

  return {
    chart_type: "stacked_bar",
    has_data: hasData,
    empty_message: hasData
      ? null
      : "No wallet activity yet. Deposit or invest to see monthly activity here.",
    labels,
    months: monthKeys,
    series,
    /** Flat points for chart libraries that prefer datasets[] */
    datasets: series,
  };
}

async function buildPortfolioDashboard(userId) {
  await ensureWallet(userId);
  const walletBalance = round2(await getBalance(userId));

  const [fds] = await pool.query(
    `SELECT f.*, b.logo_url
     FROM portfolio_fds f
     LEFT JOIN market_banks b ON b.bank_code = f.bank_code
     WHERE f.user_id = :userId AND f.status = 'active'
     ORDER BY f.created_at DESC`,
    { userId }
  );
  const [rds] = await pool.query(
    `SELECT r.*, b.logo_url
     FROM portfolio_rds r
     LEFT JOIN market_banks b ON b.bank_code = r.bank_code
     WHERE r.user_id = :userId AND r.status = 'active'
     ORDER BY r.created_at DESC`,
    { userId }
  );

  const fdsWithLogo = fds.map(withBankLogo);
  const rdsWithLogo = rds.map(withBankLogo);

  const fdInvested = round2(fds.reduce((s, r) => s + Number(r.principal_amount || 0), 0));
  const rdInvested = round2(
    rds.reduce((s, r) => s + Number(r.monthly_amount || 0) * Number(r.tenure_months || 0), 0)
  );
  const fdMaturity = round2(fds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0));
  const rdMaturity = round2(rds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0));
  const investedTotal = round2(fdInvested + rdInvested);
  const portfolioValue = round2(fdMaturity + rdMaturity + walletBalance);

  // --- Portfolio Mix (pie) ---
  const mixSegments = [
    { key: "fd", label: "Fixed Deposits", value: fdInvested, color: PIE_COLORS.fd },
    { key: "rd", label: "Recurring Deposits", value: rdInvested, color: PIE_COLORS.rd },
    { key: "wallet", label: "Wallet Cash", value: walletBalance, color: PIE_COLORS.wallet },
  ].filter((s) => s.value > 0);

  const mixTotal = mixSegments.reduce((s, x) => s + x.value, 0) || 0;
  const portfolioMix = {
    chart_type: "pie",
    has_data: mixSegments.length > 0,
    empty_message:
      mixSegments.length > 0
        ? null
        : "No FD/RD allocation yet. Book a deposit to see your mix here.",
    total: round2(mixTotal),
    segments: mixSegments.map((s) => ({
      ...s,
      percent: mixTotal ? Math.round((s.value / mixTotal) * 1000) / 10 : 0,
      value_display: `₹${s.value.toLocaleString("en-IN")}`,
    })),
    labels: mixSegments.map((s) => s.label),
    data: mixSegments.map((s) => s.value),
    colors: mixSegments.map((s) => s.color),
  };

  // --- My Investments list ---
  const investments = [
    ...fdsWithLogo.map((f) => ({
      id: f.id,
      type: "FD",
      title: `${f.bank_name || "Bank"} FD`,
      bank_name: f.bank_name,
      bank_code: f.bank_code,
      logo: f.logo,
      amount: Number(f.principal_amount),
      amount_display: `₹${Number(f.principal_amount).toLocaleString("en-IN")}`,
      interest_rate: Number(f.interest_rate),
      tenure_months: Number(f.tenure_months),
      maturity_amount: Number(f.maturity_amount),
      maturity_date: f.maturity_date,
      status: f.status,
      start_date: f.start_date,
      created_at: f.created_at,
    })),
    ...rdsWithLogo.map((r) => ({
      id: r.id,
      type: "RD",
      title: `${r.bank_name || "Bank"} RD`,
      bank_name: r.bank_name,
      bank_code: r.bank_code,
      logo: r.logo,
      amount: Number(r.monthly_amount),
      amount_display: `₹${Number(r.monthly_amount).toLocaleString("en-IN")}/mo`,
      interest_rate: Number(r.interest_rate),
      tenure_months: Number(r.tenure_months),
      maturity_amount: Number(r.maturity_amount),
      maturity_date: r.maturity_date,
      status: r.status,
      start_date: r.start_date,
      created_at: r.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // --- Recent transactions ---
  const [txRows] = await pool.query(
    `SELECT id, direction, category, amount, balance_after, reference_type, reference_id,
            description, created_at
     FROM wallet_transactions
     WHERE user_id = :userId
     ORDER BY id DESC
     LIMIT 15`,
    { userId }
  );

  const recentTransactions = txRows.map((tx) => {
    const isCredit = tx.direction === "credit";
    const amount = Number(tx.amount);
    return {
      id: tx.id,
      title: tx.description || tx.category,
      category: tx.category,
      direction: tx.direction,
      amount,
      amount_display: `${isCredit ? "+" : ""}₹${amount.toLocaleString("en-IN")}`,
      signed_amount: isCredit ? amount : -amount,
      date: tx.created_at,
      reference_type: tx.reference_type,
      reference_id: tx.reference_id,
    };
  });

  const monthlyBarChart = await buildMonthlyBarChart(userId, 6);

  let creditScore = null;
  try {
    const scores = await getLatestScores(userId);
    creditScore = {
      has_score: Boolean(scores.primary_score?.score != null),
      primary: scores.primary_score,
      cibil: scores.cibil_score,
      empty_message: scores.primary_score?.score != null
        ? null
        : "No credit score yet. Run a credit check to see your latest score here.",
      cta: {
        label: "Check my CIBIL",
        route: "/api/credit-check",
      },
    };
  } catch (err) {
    creditScore = {
      has_score: false,
      primary: null,
      cibil: null,
      empty_message: "No credit score yet. Run a credit check to see your latest score here.",
      cta: { label: "Check my CIBIL", route: "/api/credit-check" },
    };
  }

  const financialHealth = buildFinancialHealth({
    walletBalance,
    fdInvested,
    rdInvested,
    fdCount: fds.length,
    rdCount: rds.length,
    investedTotal,
  });

  return {
    summary: {
      current_balance: portfolioValue,
      current_balance_display: `₹${portfolioValue.toLocaleString("en-IN")}`,
      invested: investedTotal,
      invested_display: `₹${investedTotal.toLocaleString("en-IN")}`,
      active_fds: fds.length,
      active_rds: rds.length,
      wallet_balance: walletBalance,
      total_fd_invested: fdInvested,
      total_rd_committed: rdInvested,
      total_fd_maturity_value: fdMaturity,
      total_rd_maturity_value: rdMaturity,
      total_portfolio_value: portfolioValue,
    },
    credit_score: creditScore,
    /** Pie chart — FD / RD / Wallet mix */
    portfolio_mix: portfolioMix,
    /** Stacked bar chart — monthly wallet activity */
    monthly_bar_chart: monthlyBarChart,
    financial_health: financialHealth,
    investments,
    recent_transactions: recentTransactions,
    fd: fdsWithLogo,
    rd: rdsWithLogo,
    links: {
      fd_routes: "/api/fd",
      rd_routes: "/api/market/rd",
      wallet: "/api/wallet",
      credit_check: "/api/credit-check",
      dashboard: "/api/home/dashboard",
    },
  };
}

module.exports = {
  buildPortfolioDashboard,
};
