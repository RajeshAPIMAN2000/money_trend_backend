const pool = require("../config/db");
const { decryptPii } = require("../utils/security");

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseLimit(query, fallback = 50, max = 200) {
  return Math.min(Math.max(Number(query.limit) || fallback, 1), max);
}

function parseOffset(query) {
  return Math.max(Number(query.offset) || 0, 0);
}

function mapUserSnippet(row) {
  if (!row?.user_id && !row?.id) return null;
  return {
    id: row.user_id ?? row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
  };
}

function calcTenureProgress(startDate, maturityDate) {
  const start = new Date(startDate);
  const end = new Date(maturityDate);
  const now = new Date();
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.min(Math.max(now.getTime() - start.getTime(), 0), totalMs || 0);
  const progressRatio = totalMs > 0 ? elapsedMs / totalMs : 1;

  return {
    days_elapsed: Math.floor(elapsedMs / 86400000),
    days_remaining: Math.max(0, Math.floor((end.getTime() - now.getTime()) / 86400000)),
    progress_percent: roundMoney(progressRatio * 100),
  };
}

function formatGrowthDisplay(percent) {
  const value = roundMoney(percent);
  if (value > 0) return `+${value}%`;
  if (value < 0) return `${value}%`;
  return "0%";
}

function buildPerformance({
  invested,
  expectedGain,
  accruedGain,
  actualGain = null,
  status,
}) {
  const investedAmount = roundMoney(invested);
  const expectedReturnAmount = roundMoney(expectedGain);
  const expectedReturnPercent =
    investedAmount > 0 ? roundMoney((expectedReturnAmount / investedAmount) * 100) : 0;

  let accruedReturnAmount = roundMoney(accruedGain);
  let growthLossType = "neutral";

  if (status === "closed" && actualGain != null) {
    accruedReturnAmount = roundMoney(actualGain);
  }

  const accruedReturnPercent =
    investedAmount > 0 ? roundMoney((accruedReturnAmount / investedAmount) * 100) : 0;

  if (accruedReturnAmount > 0) growthLossType = "growth";
  else if (accruedReturnAmount < 0) growthLossType = "loss";

  const currentValue = roundMoney(investedAmount + accruedReturnAmount);

  return {
    invested_amount: investedAmount,
    invested_display: `₹${investedAmount.toLocaleString("en-IN")}`,
    current_value: currentValue,
    current_value_display: `₹${currentValue.toLocaleString("en-IN")}`,
    expected_return_amount: expectedReturnAmount,
    expected_return_percent: expectedReturnPercent,
    expected_return_display: formatGrowthDisplay(expectedReturnPercent),
    accrued_return_amount: accruedReturnAmount,
    accrued_return_percent: accruedReturnPercent,
    growth_loss_type: growthLossType,
    growth_loss_percent: accruedReturnPercent,
    growth_loss_display: formatGrowthDisplay(accruedReturnPercent),
    is_profit: accruedReturnAmount >= 0,
  };
}

function calcFdPerformance(row, settlement = null) {
  const principal = Number(row.principal_amount);
  const maturity = Number(row.maturity_amount);
  const expectedGain = maturity - principal;
  const progress = calcTenureProgress(row.start_date, row.maturity_date);

  let accruedGain = expectedGain;
  let actualGain = null;

  if (row.status === "active") {
    accruedGain = expectedGain * (progress.progress_percent / 100);
  } else if (row.status === "matured") {
    accruedGain = expectedGain;
  } else if (row.status === "closed" && settlement) {
    actualGain = Number(settlement.interest || 0) - Number(settlement.loss || 0);
    accruedGain = actualGain;
  } else if (row.status === "closed") {
    accruedGain = 0;
  }

  return {
    ...buildPerformance({
      invested: principal,
      expectedGain,
      accruedGain,
      actualGain,
      status: row.status,
    }),
    tenure_progress: progress,
  };
}

function calcRdPerformance(row, settlement = null) {
  const committed = Number(row.monthly_amount) * Number(row.tenure_months);
  const maturity = Number(row.maturity_amount);
  const expectedGain = maturity - committed;
  const progress = calcTenureProgress(row.start_date, row.maturity_date);

  let accruedGain = expectedGain;
  let actualGain = null;

  if (row.status === "active") {
    accruedGain = expectedGain * (progress.progress_percent / 100);
  } else if (row.status === "matured") {
    accruedGain = expectedGain;
  } else if (row.status === "closed" && settlement) {
    actualGain = Number(settlement.interest || 0) - Number(settlement.loss || 0);
    accruedGain = actualGain;
  } else if (row.status === "closed") {
    accruedGain = 0;
  }

  return {
    ...buildPerformance({
      invested: committed,
      expectedGain,
      accruedGain,
      actualGain,
      status: row.status,
    }),
    tenure_progress: progress,
  };
}

async function fetchSettlementMap(productType, ids = []) {
  if (!ids.length) return new Map();

  const referenceType = productType === "FD" ? "portfolio_fd" : "portfolio_rd";
  const categories =
    productType === "FD"
      ? ["fd_break_credit", "fd_break_loss"]
      : ["rd_break_credit", "rd_break_loss"];

  const [rows] = await pool.query(
    `SELECT reference_id, category, amount, meta_json
     FROM wallet_transactions
     WHERE reference_type = ?
       AND reference_id IN (${ids.map(() => "?").join(",")})
       AND category IN (${categories.map(() => "?").join(",")})
     ORDER BY created_at DESC`,
    [referenceType, ...ids, ...categories]
  );

  const map = new Map();
  for (const row of rows) {
    if (map.has(row.reference_id)) continue;
    let meta = row.meta_json;
    if (typeof meta === "string") {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = {};
      }
    }
    map.set(row.reference_id, {
      interest: meta?.interest ?? 0,
      loss: meta?.loss ?? 0,
      credit_amount: meta?.credit_amount ?? row.amount,
      category: row.category,
    });
  }
  return map;
}

function mapFdRow(row, settlement = null) {
  const performance = calcFdPerformance(row, settlement);
  return {
    id: row.id,
    user_id: row.user_id,
    user: mapUserSnippet(row),
    bank_name: row.bank_name,
    bank_code: row.bank_code,
    fd_number: row.fd_number,
    principal_amount: roundMoney(row.principal_amount),
    interest_rate: Number(row.interest_rate),
    tenure_months: row.tenure_months,
    start_date: row.start_date,
    maturity_date: row.maturity_date,
    maturity_amount: roundMoney(row.maturity_amount),
    expected_interest: roundMoney(Number(row.maturity_amount) - Number(row.principal_amount)),
    compounding: row.compounding,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    performance,
    settlement: settlement || null,
  };
}

function mapRdRow(row, settlement = null) {
  const committed = roundMoney(Number(row.monthly_amount) * Number(row.tenure_months));
  const performance = calcRdPerformance(row, settlement);
  return {
    id: row.id,
    user_id: row.user_id,
    user: mapUserSnippet(row),
    bank_name: row.bank_name,
    bank_code: row.bank_code,
    rd_number: row.rd_number,
    monthly_amount: roundMoney(row.monthly_amount),
    total_committed: committed,
    interest_rate: Number(row.interest_rate),
    tenure_months: row.tenure_months,
    start_date: row.start_date,
    maturity_date: row.maturity_date,
    maturity_amount: roundMoney(row.maturity_amount),
    expected_interest: roundMoney(Number(row.maturity_amount) - committed),
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    performance,
    settlement: settlement || null,
  };
}

const FD_SELECT = `
  f.*, u.full_name, u.email, u.phone
  FROM portfolio_fds f
  JOIN users u ON u.id = f.user_id
`;

const RD_SELECT = `
  r.*, u.full_name, u.email, u.phone
  FROM portfolio_rds r
  JOIN users u ON u.id = r.user_id
`;

function buildListSummaryFromRows(mappedRows, { investedKey, productType }) {
  const totalInvested = roundMoney(mappedRows.reduce((s, r) => s + Number(r.performance.invested_amount), 0));
  const totalCurrent = roundMoney(mappedRows.reduce((s, r) => s + Number(r.performance.current_value), 0));
  const totalExpectedReturn = roundMoney(
    mappedRows.reduce((s, r) => s + Number(r.performance.expected_return_amount), 0)
  );
  const totalAccruedReturn = roundMoney(
    mappedRows.reduce((s, r) => s + Number(r.performance.accrued_return_amount), 0)
  );
  const overallGrowthPercent =
    totalInvested > 0 ? roundMoney((totalAccruedReturn / totalInvested) * 100) : 0;

  return {
    product_type: productType,
    total_investments: mappedRows.length,
    total_invested: totalInvested,
    total_invested_display: `₹${totalInvested.toLocaleString("en-IN")}`,
    total_current_value: totalCurrent,
    total_current_value_display: `₹${totalCurrent.toLocaleString("en-IN")}`,
    total_expected_return: totalExpectedReturn,
    total_accrued_return: totalAccruedReturn,
    overall_growth_percent: overallGrowthPercent,
    overall_growth_display: formatGrowthDisplay(overallGrowthPercent),
    growth_count: mappedRows.filter((r) => r.performance.growth_loss_type === "growth").length,
    loss_count: mappedRows.filter((r) => r.performance.growth_loss_type === "loss").length,
    neutral_count: mappedRows.filter((r) => r.performance.growth_loss_type === "neutral").length,
  };
}

function buildUserBankSummary(rows, productType) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.user_id}:${row.bank_name}`;
    const invested =
      productType === "FD" ? Number(row.principal_amount) : Number(row.monthly_amount) * Number(row.tenure_months);
    const maturity = Number(row.maturity_amount);
    const existing = grouped.get(key) || {
      user_id: row.user_id,
      user_name: row.full_name,
      user_email: row.email,
      user_phone: row.phone,
      bank_name: row.bank_name,
      bank_code: row.bank_code,
      investment_count: 0,
      total_invested: 0,
      total_maturity: 0,
    };
    existing.investment_count += 1;
    existing.total_invested += invested;
    existing.total_maturity += maturity;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .map((item) => {
      const totalInvested = roundMoney(item.total_invested);
      const totalMaturity = roundMoney(item.total_maturity);
      const expectedReturn = roundMoney(totalMaturity - totalInvested);
      const growthPercent = totalInvested > 0 ? roundMoney((expectedReturn / totalInvested) * 100) : 0;
      return {
        user_id: item.user_id,
        user_name: item.user_name,
        user_email: item.user_email,
        user_phone: item.user_phone,
        bank_name: item.bank_name,
        bank_code: item.bank_code,
        investment_count: item.investment_count,
        total_invested: totalInvested,
        total_invested_display: `₹${totalInvested.toLocaleString("en-IN")}`,
        total_maturity_value: totalMaturity,
        expected_return_amount: expectedReturn,
        growth_percent: growthPercent,
        growth_display: formatGrowthDisplay(growthPercent),
        growth_loss_type: expectedReturn > 0 ? "growth" : expectedReturn < 0 ? "loss" : "neutral",
      };
    })
    .sort((a, b) => b.total_invested - a.total_invested);
}

async function listFixedDeposits(query = {}) {
  const limit = parseLimit(query);
  const offset = parseOffset(query);
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("f.user_id = :userId");
    params.userId = Number(query.user_id);
  }
  if (query.status && ["active", "matured", "closed"].includes(String(query.status))) {
    conditions.push("f.status = :status");
    params.status = query.status;
  }
  if (query.bank) {
    conditions.push("f.bank_name LIKE :bank");
    params.bank = `%${String(query.bank).trim()}%`;
  }

  const where = conditions.join(" AND ");
  const [rows] = await pool.query(
    `SELECT ${FD_SELECT} WHERE ${where} ORDER BY f.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM portfolio_fds f WHERE ${where}`,
    params
  );

  const [aggregateRows] = await pool.query(
    `SELECT
       COUNT(*) AS total_count,
       COALESCE(SUM(principal_amount), 0) AS total_invested,
       COALESCE(SUM(maturity_amount), 0) AS total_maturity
     FROM portfolio_fds f WHERE ${where}`,
    params
  );

  const closedIds = rows.filter((r) => r.status === "closed").map((r) => r.id);
  const settlements = await fetchSettlementMap("FD", closedIds);
  const fixed_deposits = rows.map((row) => mapFdRow(row, settlements.get(row.id)));
  const pageSummary = buildListSummaryFromRows(fixed_deposits, { productType: "FD" });

  const agg = aggregateRows[0] || {};
  const dbTotalInvested = roundMoney(agg.total_invested);
  const dbTotalMaturity = roundMoney(agg.total_maturity);
  const dbExpectedReturn = roundMoney(dbTotalMaturity - dbTotalInvested);
  const dbGrowthPercent =
    dbTotalInvested > 0 ? roundMoney((dbExpectedReturn / dbTotalInvested) * 100) : 0;

  return {
    count: fixed_deposits.length,
    total: Number(countRows[0]?.total || 0),
    limit,
    offset,
    summary: {
      ...pageSummary,
      all_matching_total_invested: dbTotalInvested,
      all_matching_total_maturity: dbTotalMaturity,
      all_matching_expected_return: dbExpectedReturn,
      all_matching_growth_percent: dbGrowthPercent,
      all_matching_growth_display: formatGrowthDisplay(dbGrowthPercent),
    },
    user_bank_table: buildUserBankSummary(rows, "FD"),
    investments_table: fixed_deposits.map((item) => ({
      id: item.id,
      user_id: item.user_id,
      user_name: item.user?.full_name,
      user_email: item.user?.email,
      user_phone: item.user?.phone,
      bank_name: item.bank_name,
      bank_code: item.bank_code,
      invested_amount: item.performance.invested_amount,
      invested_display: item.performance.invested_display,
      current_value: item.performance.current_value,
      current_value_display: item.performance.current_value_display,
      interest_rate: item.interest_rate,
      tenure_months: item.tenure_months,
      start_date: item.start_date,
      maturity_date: item.maturity_date,
      status: item.status,
      growth_loss_type: item.performance.growth_loss_type,
      growth_loss_percent: item.performance.growth_loss_percent,
      growth_loss_display: item.performance.growth_loss_display,
      expected_return_percent: item.performance.expected_return_percent,
      expected_return_display: item.performance.expected_return_display,
      progress_percent: item.performance.tenure_progress.progress_percent,
      created_at: item.created_at,
    })),
    fixed_deposits,
  };
}

async function getFixedDepositById(id) {
  const [rows] = await pool.query(`SELECT ${FD_SELECT} WHERE f.id = :id LIMIT 1`, { id });
  if (!rows.length) return null;
  const settlements = await fetchSettlementMap("FD", rows[0].status === "closed" ? [id] : []);
  return mapFdRow(rows[0], settlements.get(id));
}

async function listRecurringDeposits(query = {}) {
  const limit = parseLimit(query);
  const offset = parseOffset(query);
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("r.user_id = :userId");
    params.userId = Number(query.user_id);
  }
  if (query.status && ["active", "matured", "closed"].includes(String(query.status))) {
    conditions.push("r.status = :status");
    params.status = query.status;
  }
  if (query.bank) {
    conditions.push("r.bank_name LIKE :bank");
    params.bank = `%${String(query.bank).trim()}%`;
  }

  const where = conditions.join(" AND ");
  const [rows] = await pool.query(
    `SELECT ${RD_SELECT} WHERE ${where} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM portfolio_rds r WHERE ${where}`,
    params
  );

  const [aggregateRows] = await pool.query(
    `SELECT
       COUNT(*) AS total_count,
       COALESCE(SUM(monthly_amount * tenure_months), 0) AS total_invested,
       COALESCE(SUM(maturity_amount), 0) AS total_maturity
     FROM portfolio_rds r WHERE ${where}`,
    params
  );

  const closedIds = rows.filter((r) => r.status === "closed").map((r) => r.id);
  const settlements = await fetchSettlementMap("RD", closedIds);
  const recurring_deposits = rows.map((row) => mapRdRow(row, settlements.get(row.id)));
  const pageSummary = buildListSummaryFromRows(recurring_deposits, { productType: "RD" });

  const agg = aggregateRows[0] || {};
  const dbTotalInvested = roundMoney(agg.total_invested);
  const dbTotalMaturity = roundMoney(agg.total_maturity);
  const dbExpectedReturn = roundMoney(dbTotalMaturity - dbTotalInvested);
  const dbGrowthPercent =
    dbTotalInvested > 0 ? roundMoney((dbExpectedReturn / dbTotalInvested) * 100) : 0;

  return {
    count: recurring_deposits.length,
    total: Number(countRows[0]?.total || 0),
    limit,
    offset,
    summary: {
      ...pageSummary,
      all_matching_total_invested: dbTotalInvested,
      all_matching_total_maturity: dbTotalMaturity,
      all_matching_expected_return: dbExpectedReturn,
      all_matching_growth_percent: dbGrowthPercent,
      all_matching_growth_display: formatGrowthDisplay(dbGrowthPercent),
    },
    user_bank_table: buildUserBankSummary(rows, "RD"),
    investments_table: recurring_deposits.map((item) => ({
      id: item.id,
      user_id: item.user_id,
      user_name: item.user?.full_name,
      user_email: item.user?.email,
      user_phone: item.user?.phone,
      bank_name: item.bank_name,
      bank_code: item.bank_code,
      monthly_amount: item.monthly_amount,
      invested_amount: item.performance.invested_amount,
      invested_display: item.performance.invested_display,
      current_value: item.performance.current_value,
      current_value_display: item.performance.current_value_display,
      interest_rate: item.interest_rate,
      tenure_months: item.tenure_months,
      start_date: item.start_date,
      maturity_date: item.maturity_date,
      status: item.status,
      growth_loss_type: item.performance.growth_loss_type,
      growth_loss_percent: item.performance.growth_loss_percent,
      growth_loss_display: item.performance.growth_loss_display,
      expected_return_percent: item.performance.expected_return_percent,
      expected_return_display: item.performance.expected_return_display,
      progress_percent: item.performance.tenure_progress.progress_percent,
      created_at: item.created_at,
    })),
    recurring_deposits,
  };
}

async function getRecurringDepositById(id) {
  const [rows] = await pool.query(`SELECT ${RD_SELECT} WHERE r.id = :id LIMIT 1`, { id });
  if (!rows.length) return null;
  const settlements = await fetchSettlementMap("RD", rows[0].status === "closed" ? [id] : []);
  return mapRdRow(rows[0], settlements.get(id));
}

async function listPortfolios(query = {}) {
  const limit = parseLimit(query, 50, 500);
  const offset = parseOffset(query);

  const [rows] = await pool.query(
    `SELECT
       u.id AS user_id, u.full_name, u.email, u.phone,
       COALESCE(w.balance, 0) AS wallet_balance,
       (SELECT COUNT(*) FROM portfolio_fds f WHERE f.user_id = u.id AND f.status = 'active') AS active_fd_count,
       (SELECT COUNT(*) FROM portfolio_rds r WHERE r.user_id = u.id AND r.status = 'active') AS active_rd_count,
       (SELECT COALESCE(SUM(principal_amount), 0) FROM portfolio_fds f WHERE f.user_id = u.id AND f.status = 'active') AS fd_invested,
       (SELECT COALESCE(SUM(maturity_amount), 0) FROM portfolio_fds f WHERE f.user_id = u.id AND f.status = 'active') AS fd_maturity_value,
       (SELECT COALESCE(SUM(monthly_amount * tenure_months), 0) FROM portfolio_rds r WHERE r.user_id = u.id AND r.status = 'active') AS rd_committed,
       (SELECT COALESCE(SUM(maturity_amount), 0) FROM portfolio_rds r WHERE r.user_id = u.id AND r.status = 'active') AS rd_maturity_value,
       (SELECT COUNT(*) FROM wallet_deposits d WHERE d.user_id = u.id AND d.status = 'paid') AS total_deposits_count,
       (SELECT COALESCE(SUM(amount), 0) FROM wallet_deposits d WHERE d.user_id = u.id AND d.status = 'paid') AS total_deposits_amount,
       (SELECT COUNT(*) FROM withdrawal_requests wr WHERE wr.user_id = u.id) AS total_withdrawals_count,
       (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.user_id = u.id) AS total_transactions_count
     FROM users u
     LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.role = 'user'
     ORDER BY u.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  );

  const portfolios = rows.map((row) => {
    const fdInvested = roundMoney(row.fd_invested);
    const rdCommitted = roundMoney(row.rd_committed);
    const walletBalance = roundMoney(row.wallet_balance);
    const fdMaturity = roundMoney(row.fd_maturity_value);
    const rdMaturity = roundMoney(row.rd_maturity_value);

    return {
      user_id: row.user_id,
      user: { id: row.user_id, full_name: row.full_name, email: row.email, phone: row.phone },
      active_fd_count: Number(row.active_fd_count),
      active_rd_count: Number(row.active_rd_count),
      fd_invested: fdInvested,
      rd_committed: rdCommitted,
      wallet_balance: walletBalance,
      fd_maturity_value: fdMaturity,
      rd_maturity_value: rdMaturity,
      portfolio_value: roundMoney(fdMaturity + rdMaturity + walletBalance),
      total_invested: roundMoney(fdInvested + rdCommitted),
      total_deposits_count: Number(row.total_deposits_count),
      total_deposits_amount: roundMoney(row.total_deposits_amount),
      total_withdrawals_count: Number(row.total_withdrawals_count),
      total_transactions_count: Number(row.total_transactions_count),
    };
  });

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE role = 'user'`);

  return { count: portfolios.length, total: Number(countRows[0]?.total || 0), limit, offset, portfolios };
}

async function getPortfolioByUserId(userId) {
  const [users] = await pool.query(
    `SELECT id, full_name, email, phone, kyc_status, created_at FROM users WHERE id = :userId AND role = 'user' LIMIT 1`,
    { userId }
  );
  if (!users.length) return null;

  const user = users[0];
  const [fds] = await pool.query(
    `SELECT f.*, u.full_name, u.email, u.phone FROM portfolio_fds f JOIN users u ON u.id = f.user_id
     WHERE f.user_id = :userId ORDER BY f.created_at DESC`,
    { userId }
  );
  const [rds] = await pool.query(
    `SELECT r.*, u.full_name, u.email, u.phone FROM portfolio_rds r JOIN users u ON u.id = r.user_id
     WHERE r.user_id = :userId ORDER BY r.created_at DESC`,
    { userId }
  );
  const [walletRows] = await pool.query(
    `SELECT balance, currency, status FROM wallets WHERE user_id = :userId LIMIT 1`,
    { userId }
  );

  const fdList = fds.map(mapFdRow);
  const rdList = rds.map(mapRdRow);
  const fdInvested = roundMoney(fds.filter((f) => f.status === "active").reduce((s, r) => s + Number(r.principal_amount), 0));
  const rdCommitted = roundMoney(
    rds.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.monthly_amount) * Number(r.tenure_months), 0)
  );
  const walletBalance = roundMoney(walletRows[0]?.balance || 0);

  const [[depositStats]] = await pool.query(
    `SELECT COUNT(*) AS total_count,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_amount,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
     FROM wallet_deposits WHERE user_id = :userId`,
    { userId }
  );

  const [[withdrawalStats]] = await pool.query(
    `SELECT COUNT(*) AS total_count,
            COALESCE(SUM(amount), 0) AS total_amount,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
     FROM withdrawal_requests WHERE user_id = :userId`,
    { userId }
  );

  const [[orderStats]] = await pool.query(
    `SELECT COUNT(*) AS total_count, COALESCE(SUM(amount), 0) AS total_amount
     FROM wallet_transactions
     WHERE user_id = :userId AND category IN ('fd_invest', 'rd_invest')`,
    { userId }
  );

  const [[txStats]] = await pool.query(
    `SELECT COUNT(*) AS total_count FROM wallet_transactions WHERE user_id = :userId`,
    { userId }
  );

  return {
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      kyc_status: user.kyc_status,
      member_since: user.created_at,
    },
    summary: {
      active_fd_count: fdList.filter((f) => f.status === "active").length,
      active_rd_count: rdList.filter((r) => r.status === "active").length,
      fd_invested: fdInvested,
      rd_committed: rdCommitted,
      wallet_balance: walletBalance,
      portfolio_value: roundMoney(
        fdList.filter((f) => f.status === "active").reduce((s, r) => s + Number(r.maturity_amount), 0) +
          rdList.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.maturity_amount), 0) +
          walletBalance
      ),
      total_deposits_count: Number(depositStats.paid_count),
      total_deposits_amount: roundMoney(depositStats.paid_amount),
      total_withdrawals_count: Number(withdrawalStats.total_count),
      total_withdrawals_amount: roundMoney(withdrawalStats.total_amount),
      total_orders_count: Number(orderStats.total_count),
      total_orders_amount: roundMoney(orderStats.total_amount),
      total_transactions_count: Number(txStats.total_count),
    },
    fixed_deposits: fdList,
    recurring_deposits: rdList,
    wallet: walletRows[0]
      ? { balance: walletBalance, currency: walletRows[0].currency, status: walletRows[0].status }
      : { balance: 0, currency: "INR", status: "active" },
  };
}

async function listDeposits(query = {}) {
  const limit = parseLimit(query);
  const offset = parseOffset(query);
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("d.user_id = :userId");
    params.userId = Number(query.user_id);
  }
  if (query.status && ["created", "paid", "failed"].includes(String(query.status))) {
    conditions.push("d.status = :status");
    params.status = query.status;
  }

  const where = conditions.join(" AND ");
  const [rows] = await pool.query(
    `SELECT d.*, u.full_name, u.email, u.phone
     FROM wallet_deposits d JOIN users u ON u.id = d.user_id
     WHERE ${where} ORDER BY d.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total
     FROM wallet_deposits d WHERE ${where}`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    total_paid_amount: roundMoney(countRows[0]?.paid_total),
    limit,
    offset,
    deposits: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user: mapUserSnippet(row),
      amount: roundMoney(row.amount),
      currency: row.currency,
      razorpay_order_id: row.razorpay_order_id,
      razorpay_payment_id: row.razorpay_payment_id,
      status: row.status,
      credited_at: row.credited_at,
      created_at: row.created_at,
    })),
  };
}

async function getDepositById(id) {
  const [rows] = await pool.query(
    `SELECT d.*, u.full_name, u.email, u.phone
     FROM wallet_deposits d JOIN users u ON u.id = d.user_id WHERE d.id = :id LIMIT 1`,
    { id }
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    user: mapUserSnippet(row),
    amount: roundMoney(row.amount),
    currency: row.currency,
    razorpay_order_id: row.razorpay_order_id,
    razorpay_payment_id: row.razorpay_payment_id,
    receipt: row.receipt,
    status: row.status,
    credited_at: row.credited_at,
    created_at: row.created_at,
  };
}

async function getUserDepositSummary(userId) {
  const [users] = await pool.query(
    `SELECT id, full_name, email, phone FROM users WHERE id = :userId AND role = 'user' LIMIT 1`,
    { userId }
  );
  if (!users.length) return null;

  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_amount
     FROM wallet_deposits WHERE user_id = :userId`,
    { userId }
  );

  const [deposits] = await pool.query(
    `SELECT id, amount, status, razorpay_order_id, razorpay_payment_id, credited_at, created_at
     FROM wallet_deposits WHERE user_id = :userId ORDER BY created_at DESC LIMIT 50`,
    { userId }
  );

  return {
    user: users[0],
    summary: {
      total_deposits_count: Number(stats.total_count),
      paid_deposits_count: Number(stats.paid_count),
      failed_deposits_count: Number(stats.failed_count),
      total_deposits_amount: roundMoney(stats.paid_amount),
    },
    deposits,
  };
}

async function getWithdrawalById(id) {
  const [rows] = await pool.query(
    `SELECT w.*, u.full_name, u.email, u.phone,
            b.account_holder_name, b.bank_name, b.branch_name, b.ifsc_code,
            b.account_number_enc, b.account_last4
     FROM withdrawal_requests w
     JOIN users u ON u.id = w.user_id
     JOIN user_bank_accounts b ON b.id = w.bank_account_id
     WHERE w.id = :id LIMIT 1`,
    { id }
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    user_id: r.user_id,
    user: mapUserSnippet(r),
    amount: roundMoney(r.amount),
    status: r.status,
    admin_note: r.admin_note,
    processed_by: r.processed_by,
    processed_at: r.processed_at,
    created_at: r.created_at,
    bank: {
      account_holder_name: r.account_holder_name,
      bank_name: r.bank_name,
      branch_name: r.branch_name,
      ifsc_code: r.ifsc_code,
      account_number: decryptPii(r.account_number_enc) || null,
      account_last4: r.account_last4,
    },
  };
}

async function listOrders(query = {}) {
  const limit = parseLimit(query);
  const offset = parseOffset(query);
  const params = {};
  let where = "wt.category IN ('fd_invest', 'rd_invest', 'admin_commission')";

  if (query.user_id) {
    where += " AND wt.user_id = :userId";
    params.userId = Number(query.user_id);
  }
  if (query.category && ["fd_invest", "rd_invest", "admin_commission"].includes(String(query.category))) {
    where = "wt.category = :category";
    params.category = query.category;
    if (query.user_id) {
      where += " AND wt.user_id = :userId";
      params.userId = Number(query.user_id);
    }
  }

  const [rows] = await pool.query(
    `SELECT wt.*, u.full_name, u.email, u.phone
     FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
     WHERE ${where} ORDER BY wt.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(wt.amount), 0) AS total_amount
     FROM wallet_transactions wt WHERE ${where}`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    total_amount: roundMoney(countRows[0]?.total_amount),
    limit,
    offset,
    orders: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user: mapUserSnippet(row),
      direction: row.direction,
      category: row.category,
      order_type: row.category === "fd_invest" ? "FD" : row.category === "rd_invest" ? "RD" : "Commission",
      amount: roundMoney(row.amount),
      balance_after: roundMoney(row.balance_after),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      description: row.description,
      created_at: row.created_at,
    })),
  };
}

async function getOrderById(id) {
  const [rows] = await pool.query(
    `SELECT wt.*, u.full_name, u.email, u.phone
     FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
     WHERE wt.id = :id AND wt.category IN ('fd_invest', 'rd_invest', 'admin_commission') LIMIT 1`,
    { id }
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    user: mapUserSnippet(row),
    direction: row.direction,
    category: row.category,
    order_type: row.category === "fd_invest" ? "FD" : row.category === "rd_invest" ? "RD" : "Commission",
    amount: roundMoney(row.amount),
    balance_after: roundMoney(row.balance_after),
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    description: row.description,
    meta_json: row.meta_json,
    created_at: row.created_at,
  };
}

async function listTransactionHistory(query = {}) {
  const limit = parseLimit(query);
  const offset = parseOffset(query);
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("wt.user_id = :userId");
    params.userId = Number(query.user_id);
  }
  if (query.category) {
    conditions.push("wt.category = :category");
    params.category = String(query.category);
  }
  if (query.direction && ["credit", "debit"].includes(String(query.direction))) {
    conditions.push("wt.direction = :direction");
    params.direction = query.direction;
  }

  const where = conditions.join(" AND ");
  const [rows] = await pool.query(
    `SELECT wt.*, u.full_name, u.email, u.phone
     FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
     WHERE ${where} ORDER BY wt.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM wallet_transactions wt WHERE ${where}`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    limit,
    offset,
    transactions: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user: mapUserSnippet(row),
      direction: row.direction,
      category: row.category,
      amount: roundMoney(row.amount),
      balance_after: roundMoney(row.balance_after),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      description: row.description,
      created_at: row.created_at,
    })),
  };
}

async function getTransactionById(id) {
  const [rows] = await pool.query(
    `SELECT wt.*, u.full_name, u.email, u.phone
     FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
     WHERE wt.id = :id LIMIT 1`,
    { id }
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    user: mapUserSnippet(row),
    direction: row.direction,
    category: row.category,
    amount: roundMoney(row.amount),
    balance_after: roundMoney(row.balance_after),
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    description: row.description,
    meta_json: row.meta_json,
    created_at: row.created_at,
  };
}

const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#4f46e5",
  "#be185d",
  "#0d9488",
  "#64748b",
];

function buildPieChartPayload(rows, { title, valueKey = "value", labelKey = "label", keyKey = "key" }) {
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0);
  const segments = rows.map((row, index) => {
    const value = roundMoney(row[valueKey]);
    const percent = total > 0 ? roundMoney((value / total) * 100) : 0;
    return {
      key: row[keyKey] || row.bank_code || `segment_${index}`,
      label: row[labelKey] || row.bank_name || `Segment ${index + 1}`,
      bank_name: row.bank_name || null,
      bank_code: row.bank_code || null,
      value,
      value_display: `₹${value.toLocaleString("en-IN")}`,
      percent,
      color: PIE_COLORS[index % PIE_COLORS.length],
      count: Number(row.count || row.investment_count || 0),
    };
  });

  return {
    title,
    chart_type: "pie",
    total: roundMoney(total),
    total_display: `₹${roundMoney(total).toLocaleString("en-IN")}`,
    labels: segments.map((s) => s.label),
    data: segments.map((s) => s.value),
    percentages: segments.map((s) => s.percent),
    segments,
  };
}

async function getFdAssetAllocation(query = {}) {
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("user_id = :userId");
    params.userId = Number(query.user_id);
  }
  const status = query.status || "active";
  if (status !== "all") {
    conditions.push("status = :status");
    params.status = status;
  }

  const [rows] = await pool.query(
    `SELECT bank_name, bank_code,
            COUNT(*) AS investment_count,
            COALESCE(SUM(principal_amount), 0) AS total_value,
            COALESCE(SUM(maturity_amount), 0) AS total_maturity
     FROM portfolio_fds
     WHERE ${conditions.join(" AND ")}
     GROUP BY bank_name, bank_code
     ORDER BY total_value DESC`,
    params
  );

  const mapped = rows.map((r) => ({
    key: r.bank_code || r.bank_name,
    label: r.bank_name,
    bank_name: r.bank_name,
    bank_code: r.bank_code,
    value: Number(r.total_value),
    count: Number(r.investment_count),
    maturity_value: roundMoney(r.total_maturity),
  }));

  if (!mapped.length) {
    return {
      product_type: "FD",
      ...buildPieChartPayload(
        [{ key: "no_data", label: "No FD investments", value: 1 }],
        { title: "Fixed Deposit Asset Allocation" }
      ),
      empty: true,
      note: "No active FD investments yet",
    };
  }

  return {
    product_type: "FD",
    metric: "principal_amount",
    ...buildPieChartPayload(mapped, { title: "Fixed Deposit Asset Allocation" }),
    empty: false,
  };
}

async function getRdAssetAllocation(query = {}) {
  const params = {};
  const conditions = ["1=1"];

  if (query.user_id) {
    conditions.push("user_id = :userId");
    params.userId = Number(query.user_id);
  }
  const status = query.status || "active";
  if (status !== "all") {
    conditions.push("status = :status");
    params.status = status;
  }

  const [rows] = await pool.query(
    `SELECT bank_name, bank_code,
            COUNT(*) AS investment_count,
            COALESCE(SUM(monthly_amount * tenure_months), 0) AS total_value,
            COALESCE(SUM(maturity_amount), 0) AS total_maturity
     FROM portfolio_rds
     WHERE ${conditions.join(" AND ")}
     GROUP BY bank_name, bank_code
     ORDER BY total_value DESC`,
    params
  );

  const mapped = rows.map((r) => ({
    key: r.bank_code || r.bank_name,
    label: r.bank_name,
    bank_name: r.bank_name,
    bank_code: r.bank_code,
    value: Number(r.total_value),
    count: Number(r.investment_count),
    maturity_value: roundMoney(r.total_maturity),
  }));

  if (!mapped.length) {
    return {
      product_type: "RD",
      ...buildPieChartPayload(
        [{ key: "no_data", label: "No RD investments", value: 1 }],
        { title: "Recurring Deposit Asset Allocation" }
      ),
      empty: true,
      note: "No active RD investments yet",
    };
  }

  return {
    product_type: "RD",
    metric: "total_committed",
    ...buildPieChartPayload(mapped, { title: "Recurring Deposit Asset Allocation" }),
    empty: false,
  };
}

async function getAssetAllocationOverview(query = {}) {
  const [fixed_deposits, recurring_deposits] = await Promise.all([
    getFdAssetAllocation(query),
    getRdAssetAllocation(query),
  ]);

  const fdTotal = fixed_deposits.total || 0;
  const rdTotal = recurring_deposits.total || 0;
  const combinedTotal = roundMoney(fdTotal + rdTotal);

  const combinedSegments = [
    {
      key: "fixed_deposits",
      label: "Fixed Deposits",
      value: fdTotal,
      percent: combinedTotal > 0 ? roundMoney((fdTotal / combinedTotal) * 100) : 0,
      color: PIE_COLORS[0],
    },
    {
      key: "recurring_deposits",
      label: "Recurring Deposits",
      value: rdTotal,
      percent: combinedTotal > 0 ? roundMoney((rdTotal / combinedTotal) * 100) : 0,
      color: PIE_COLORS[1],
    },
  ].filter((s) => s.value > 0);

  return {
    fixed_deposits,
    recurring_deposits,
    combined: {
      title: "Overall FD vs RD Allocation",
      chart_type: "pie",
      total: combinedTotal,
      total_display: `₹${combinedTotal.toLocaleString("en-IN")}`,
      labels: combinedSegments.map((s) => s.label),
      data: combinedSegments.map((s) => s.value),
      percentages: combinedSegments.map((s) => s.percent),
      segments: combinedSegments,
    },
  };
}

async function getPlatformInvestmentByBank() {
  const [fdRows] = await pool.query(
    `SELECT bank_name, bank_code,
            COUNT(*) AS investment_count,
            COALESCE(SUM(principal_amount), 0) AS total_invested,
            COALESCE(SUM(maturity_amount), 0) AS total_maturity,
            COALESCE(AVG(interest_rate), 0) AS avg_interest_rate
     FROM portfolio_fds
     WHERE status = 'active'
     GROUP BY bank_name, bank_code
     ORDER BY total_invested DESC`
  );

  const [rdRows] = await pool.query(
    `SELECT bank_name, bank_code,
            COUNT(*) AS investment_count,
            COALESCE(SUM(monthly_amount * tenure_months), 0) AS total_committed,
            COALESCE(SUM(maturity_amount), 0) AS total_maturity,
            COALESCE(AVG(interest_rate), 0) AS avg_interest_rate
     FROM portfolio_rds
     WHERE status = 'active'
     GROUP BY bank_name, bank_code
     ORDER BY total_committed DESC`
  );

  return {
    fixed_deposits: fdRows.map((r) => ({
      bank_name: r.bank_name,
      bank_code: r.bank_code,
      investment_count: Number(r.investment_count),
      total_invested: roundMoney(r.total_invested),
      total_maturity: roundMoney(r.total_maturity),
      avg_interest_rate: roundMoney(r.avg_interest_rate),
      expected_interest: roundMoney(Number(r.total_maturity) - Number(r.total_invested)),
    })),
    recurring_deposits: rdRows.map((r) => ({
      bank_name: r.bank_name,
      bank_code: r.bank_code,
      investment_count: Number(r.investment_count),
      total_committed: roundMoney(r.total_committed),
      total_maturity: roundMoney(r.total_maturity),
      avg_interest_rate: roundMoney(r.avg_interest_rate),
      expected_interest: roundMoney(Number(r.total_maturity) - Number(r.total_committed)),
    })),
  };
}

module.exports = {
  listFixedDeposits,
  getFixedDepositById,
  listRecurringDeposits,
  getRecurringDepositById,
  listPortfolios,
  getPortfolioByUserId,
  listDeposits,
  getDepositById,
  getUserDepositSummary,
  getWithdrawalById,
  listOrders,
  getOrderById,
  listTransactionHistory,
  getTransactionById,
  getFdAssetAllocation,
  getRdAssetAllocation,
  getAssetAllocationOverview,
  getPlatformInvestmentByBank,
};
