/**
 * DEMO / UAT investment layer — virtual funds only.
 * Reuses existing wallets + portfolio_fds/rds + withdrawal_requests.
 * Does NOT replace live Razorpay or real payouts.
 */

const pool = require("../config/db");
const {
  ensureWallet,
  getBalance,
  creditWallet,
  debitWallet,
  investFromWallet,
  settleInvestmentToWallet,
  roundMoney,
  getCommissionPercent,
  checkInvestAffordability,
} = require("./walletService");
const { writeAuditLog } = require("../utils/audit");

const DEMO_NOTICE =
  "DEMO MODE — Virtual funds only. No real money is invested, withdrawn, or transferred.";

const DEMO_CREDIT_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000];

const DEMO_FD_PRODUCTS = [
  {
    code: "DEMO_FD_12",
    name: "Demo Bank FD — 12 Months",
    interest_rate: 7.5,
    tenure_months: 12,
    min_amount: 1000,
    max_amount: 1000000,
    compounding: "quarterly",
    demo_label: "Demo product — not an actual bank deposit.",
  },
  {
    code: "DEMO_FD_24",
    name: "Demo Bank FD — 24 Months",
    interest_rate: 8.0,
    tenure_months: 24,
    min_amount: 1000,
    max_amount: 1000000,
    compounding: "quarterly",
    demo_label: "Demo product — not an actual bank deposit.",
  },
];

const DEMO_RD_PRODUCTS = [
  {
    code: "DEMO_RD_12",
    name: "Demo Bank RD — 12 Months",
    interest_rate: 7.0,
    tenure_months: 12,
    min_monthly: 500,
    max_monthly: 100000,
    demo_label: "Demo product — not an actual bank deposit.",
  },
  {
    code: "DEMO_RD_24",
    name: "Demo Bank RD — 24 Months",
    interest_rate: 7.5,
    tenure_months: 24,
    min_monthly: 500,
    max_monthly: 100000,
    demo_label: "Demo product — not an actual bank deposit.",
  },
];

function isDemoModeEnabled() {
  const v = String(process.env.DEMO_MODE || process.env.DUMMY_PAYMENT_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

function demoEnvelope(data = {}) {
  return {
    demo_mode: true,
    demo_notice: DEMO_NOTICE,
    ...data,
  };
}

function formatDemoTxnId(numericId, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `DEMO-TXN-${y}${m}${d}${String(numericId).padStart(4, "0")}`;
}

function formatDemoWdId(numericId, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `DEMO-WD-${y}${m}${d}${String(numericId).padStart(4, "0")}`;
}

function formatFdRef(numericId, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `FD${y}${m}${d}${String(numericId).padStart(4, "0")}`;
}

function formatRdRef(numericId, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `RD${y}${m}${d}${String(numericId).padStart(4, "0")}`;
}

function mapLedgerType(category) {
  const c = String(category || "");
  const map = {
    DEMO_CREDIT: "DEMO_CREDIT",
    wallet_deposit: "DEMO_CREDIT",
    razorpay_deposit: "DEMO_CREDIT",
    dummy_payment: "DEMO_CREDIT",
    fd_invest: "INVESTMENT_DEBIT",
    rd_invest: "INVESTMENT_DEBIT",
    admin_commission: "INVESTMENT_DEBIT",
    fd_break_credit: "INVESTMENT_RETURN",
    rd_break_credit: "INVESTMENT_RETURN",
    INVESTMENT_RETURN: "INVESTMENT_RETURN",
    withdrawal_hold: "WITHDRAWAL_REQUEST",
    withdrawal_refund: "WITHDRAWAL_REJECTED",
    WITHDRAWAL_COMPLETED: "WITHDRAWAL_COMPLETED",
  };
  return map[c] || c.toUpperCase();
}

function calcFdMaturity(principal, ratePercent, tenureMonths, compounding = "quarterly") {
  const P = Number(principal);
  const r = Number(ratePercent) / 100;
  const years = Number(tenureMonths) / 12;
  let n = 4;
  if (compounding === "monthly") n = 12;
  if (compounding === "yearly") n = 1;
  if (compounding === "simple") return roundMoney(P + P * r * years);
  return roundMoney(P * Math.pow(1 + r / n, n * years));
}

function calcRdMaturity(monthlyAmount, ratePercent, tenureMonths) {
  const R = Number(monthlyAmount);
  const i = Number(ratePercent) / 400;
  const n = Number(tenureMonths);
  if (i === 0) return roundMoney(R * n);
  return roundMoney(R * ((Math.pow(1 + i, n) - 1) / i));
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}

async function sumTx(userId, categories, direction) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM wallet_transactions
     WHERE user_id = :userId
       AND direction = :direction
       AND category IN (${categories.map((_, i) => `:c${i}`).join(",")})`,
    {
      userId,
      direction,
      ...Object.fromEntries(categories.map((c, i) => [`c${i}`, c])),
    }
  );
  return roundMoney(rows[0]?.total || 0);
}

async function getDemoWalletSummary(userId) {
  await ensureWallet(userId);
  const available = await getBalance(userId);

  const totalCredited = await sumTx(
    userId,
    ["DEMO_CREDIT", "wallet_deposit", "razorpay_deposit", "dummy_payment"],
    "credit"
  );
  const totalInvested = await sumTx(userId, ["fd_invest", "rd_invest"], "debit");
  const totalReturns = await sumTx(
    userId,
    ["fd_break_credit", "rd_break_credit", "INVESTMENT_RETURN"],
    "credit"
  );
  const totalWithdrawnHold = await sumTx(userId, ["withdrawal_hold"], "debit");
  const totalWithdrawnRefund = await sumTx(userId, ["withdrawal_refund"], "credit");
  const totalWithdrawn = roundMoney(Math.max(0, totalWithdrawnHold - totalWithdrawnRefund));

  const [fds] = await pool.query(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS mat, COALESCE(SUM(principal_amount), 0) AS prin
     FROM portfolio_fds WHERE user_id = :userId AND status = 'active'`,
    { userId }
  );
  const [rds] = await pool.query(
    `SELECT COALESCE(SUM(maturity_amount), 0) AS mat,
            COALESCE(SUM(monthly_amount * LEAST(COALESCE(installments_paid, 1), tenure_months)), 0) AS deposited
     FROM portfolio_rds WHERE user_id = :userId AND status = 'active'`,
    { userId }
  );

  const fdMaturity = roundMoney(fds[0]?.mat || 0);
  const rdMaturity = roundMoney(rds[0]?.mat || 0);
  const portfolioValue = roundMoney(available + fdMaturity + rdMaturity);

  return demoEnvelope({
    label: "DEMO WALLET — Virtual funds only. No real money.",
    currency: "INR",
    available_balance: available,
    available_balance_display: `₹${available.toLocaleString("en-IN")}`,
    total_demo_money_added: totalCredited,
    total_invested: totalInvested,
    total_returns: totalReturns,
    total_withdrawn: totalWithdrawn,
    total_portfolio_value: portfolioValue,
    total_portfolio_value_display: `₹${portfolioValue.toLocaleString("en-IN")}`,
    active_fd_maturity_value: fdMaturity,
    active_rd_maturity_value: rdMaturity,
    admin_fee_percent: getCommissionPercent(),
  });
}

async function listDemoTransactions(userId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [rows] = await pool.query(
    `SELECT id, direction, category, amount, balance_after, reference_type, reference_id,
            description, meta_json, created_at
     FROM wallet_transactions
     WHERE user_id = :userId
     ORDER BY id DESC
     LIMIT ${safeLimit}`,
    { userId }
  );

  return rows.map((tx) => {
    const amount = roundMoney(tx.amount);
    const after = roundMoney(tx.balance_after);
    const before =
      tx.direction === "credit" ? roundMoney(after - amount) : roundMoney(after + amount);
    let meta = null;
    try {
      meta = tx.meta_json ? (typeof tx.meta_json === "string" ? JSON.parse(tx.meta_json) : tx.meta_json) : null;
    } catch (_e) {
      meta = null;
    }
    return {
      transaction_id: tx.id,
      demo_txn_id: meta?.demo_txn_id || formatDemoTxnId(tx.id, new Date(tx.created_at)),
      user_id: userId,
      type: mapLedgerType(tx.category),
      category: tx.category,
      amount,
      balance_before: before,
      balance_after: after,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      description: tx.description,
      status: "completed",
      created_at: tx.created_at,
      demo_mode: true,
    };
  });
}

/**
 * Instant DEMO_CREDIT (no payment gateway). Separate from Razorpay & dummy card OTP.
 */
async function addDemoMoney(userId, amountRaw) {
  if (!isDemoModeEnabled()) {
    const err = new Error("DEMO MODE is disabled on this server");
    err.code = "DEMO_DISABLED";
    throw err;
  }
  const amount = roundMoney(amountRaw);
  if (!amount || amount < 1) {
    const err = new Error("Amount must be at least ₹1");
    err.code = "INVALID_AMOUNT";
    throw err;
  }
  if (amount > 1000000) {
    const err = new Error("Demo credit max is ₹10,00,000 per request");
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const before = await getBalance(userId);
  const credit = await creditWallet({
    userId,
    amount,
    category: "DEMO_CREDIT",
    referenceType: "demo_credit",
    description: `DEMO MODE — virtual funds credited (₹${amount.toLocaleString("en-IN")})`,
    meta: { demo: true, preset: DEMO_CREDIT_PRESETS.includes(amount) },
  });

  const demoTxnId = formatDemoTxnId(credit.transaction_id);
  await pool.query(
    `UPDATE wallet_transactions
     SET meta_json = JSON_SET(COALESCE(meta_json, '{}'), '$.demo_txn_id', :demoTxnId)
     WHERE id = :id`,
    { demoTxnId, id: credit.transaction_id }
  );

  return demoEnvelope({
    message: "Demo payment successful",
    transaction_id: credit.transaction_id,
    demo_txn_id: demoTxnId,
    type: "DEMO_CREDIT",
    amount,
    balance_before: before,
    balance_after: credit.balance,
    presets: DEMO_CREDIT_PRESETS,
  });
}

function listDemoProducts() {
  return demoEnvelope({
    fd: DEMO_FD_PRODUCTS.map((p) => ({
      ...p,
      estimated_maturity_example: calcFdMaturity(20000, p.interest_rate, p.tenure_months, p.compounding),
    })),
    rd: DEMO_RD_PRODUCTS.map((p) => ({
      ...p,
      estimated_maturity_example: calcRdMaturity(2000, p.interest_rate, p.tenure_months),
    })),
  });
}

function estimateFd({ amount, interest_rate, tenure_months, compounding }) {
  const principal = roundMoney(amount);
  const rate = Number(interest_rate);
  const tenure = Number(tenure_months);
  const maturity = calcFdMaturity(principal, rate, tenure, compounding || "quarterly");
  const start = new Date().toISOString().slice(0, 10);
  return demoEnvelope({
    principal,
    interest_rate: rate,
    tenure_months: tenure,
    start_date: start,
    maturity_date: addMonths(start, tenure),
    estimated_maturity_amount: maturity,
    estimated_interest: roundMoney(maturity - principal),
  });
}

function estimateRd({ monthly_amount, interest_rate, tenure_months }) {
  const monthly = roundMoney(monthly_amount);
  const rate = Number(interest_rate);
  const tenure = Number(tenure_months);
  const maturity = calcRdMaturity(monthly, rate, tenure);
  const start = new Date().toISOString().slice(0, 10);
  return demoEnvelope({
    monthly_amount: monthly,
    interest_rate: rate,
    tenure_months: tenure,
    total_deposit: roundMoney(monthly * tenure),
    start_date: start,
    next_installment_date: addMonths(start, 1),
    maturity_date: addMonths(start, tenure),
    estimated_maturity_amount: maturity,
  });
}

async function createDemoFd(userId, body) {
  const productCode = String(body.product_code || body.product || "").toUpperCase();
  const product = DEMO_FD_PRODUCTS.find((p) => p.code === productCode) || DEMO_FD_PRODUCTS[0];
  const principal = roundMoney(body.amount || body.principal_amount || body.principal);
  if (!principal || principal < product.min_amount) {
    const err = new Error(`Minimum investment is ₹${product.min_amount}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (principal > product.max_amount) {
    const err = new Error(`Maximum investment is ₹${product.max_amount}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const afford = await checkInvestAffordability(userId, principal, "FD");
  if (!afford.can_pay_from_wallet) {
    const err = new Error(
      `Insufficient demo wallet. Need ₹${afford.required_total}. Add demo money first.`
    );
    err.code = "INSUFFICIENT_BALANCE";
    err.data = afford;
    throw err;
  }

  const start = new Date().toISOString().slice(0, 10);
  const tenure = product.tenure_months;
  const rate = product.interest_rate;
  const maturityDate = addMonths(start, tenure);
  const maturityAmount = calcFdMaturity(principal, rate, tenure, product.compounding);

  const [result] = await pool.query(
    `INSERT INTO portfolio_fds
      (user_id, bank_name, bank_code, fd_number, principal_amount, interest_rate,
       tenure_months, start_date, maturity_date, maturity_amount, compounding, notes, status)
     VALUES
      (:userId, :bankName, :bankCode, :fdNumber, :principal, :rate,
       :tenure, :start, :maturityDate, :maturityAmount, :compounding, :notes, 'active')`,
    {
      userId,
      bankName: product.name,
      bankCode: product.code,
      fdNumber: null,
      principal,
      rate,
      tenure,
      start,
      maturityDate,
      maturityAmount,
      compounding: product.compounding,
      notes: "DEMO MODE investment — virtual funds only",
    }
  );

  const fdId = result.insertId;
  const fdRef = formatFdRef(fdId);
  await pool.query(`UPDATE portfolio_fds SET fd_number = :fdRef WHERE id = :id`, {
    fdRef,
    id: fdId,
  });

  let walletResult;
  try {
    walletResult = await investFromWallet({
      userId,
      investAmount: principal,
      productType: "FD",
      productId: fdId,
      description: `DEMO FD investment ${fdRef}`,
    });
  } catch (e) {
    await pool.query(`DELETE FROM portfolio_fds WHERE id = :id`, { id: fdId });
    throw e;
  }

  return demoEnvelope({
    message: "Demo FD investment successful",
    investment: {
      id: fdId,
      reference_number: fdRef,
      type: "FD",
      product: product.name,
      product_code: product.code,
      principal_amount: principal,
      interest_rate: rate,
      tenure_months: tenure,
      start_date: start,
      maturity_date: maturityDate,
      maturity_amount: maturityAmount,
      status: "ACTIVE",
      demo_label: product.demo_label,
    },
    wallet: {
      total_debited: walletResult.total_debited,
      admin_commission: walletResult.commission,
      balance: walletResult.balance,
    },
  });
}

async function createDemoRd(userId, body) {
  const productCode = String(body.product_code || body.product || "").toUpperCase();
  const product = DEMO_RD_PRODUCTS.find((p) => p.code === productCode) || DEMO_RD_PRODUCTS[0];
  const monthly = roundMoney(body.monthly_amount || body.amount);
  if (!monthly || monthly < product.min_monthly) {
    const err = new Error(`Minimum monthly installment is ₹${product.min_monthly}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const afford = await checkInvestAffordability(userId, monthly, "RD");
  if (!afford.can_pay_from_wallet) {
    const err = new Error(
      `Insufficient demo wallet. Need ₹${afford.required_total} for first installment.`
    );
    err.code = "INSUFFICIENT_BALANCE";
    err.data = afford;
    throw err;
  }

  const start = new Date().toISOString().slice(0, 10);
  const tenure = product.tenure_months;
  const rate = product.interest_rate;
  const maturityDate = addMonths(start, tenure);
  const maturityAmount = calcRdMaturity(monthly, rate, tenure);

  const [result] = await pool.query(
    `INSERT INTO portfolio_rds
      (user_id, bank_name, bank_code, rd_number, monthly_amount, interest_rate,
       tenure_months, start_date, maturity_date, maturity_amount, notes, status, installments_paid)
     VALUES
      (:userId, :bankName, :bankCode, NULL, :monthly, :rate,
       :tenure, :start, :maturityDate, :maturityAmount, :notes, 'active', 1)`,
    {
      userId,
      bankName: product.name,
      bankCode: product.code,
      monthly,
      rate,
      tenure,
      start,
      maturityDate,
      maturityAmount,
      notes: "DEMO MODE RD — virtual funds only",
    }
  );

  const rdId = result.insertId;
  const rdRef = formatRdRef(rdId);
  await pool.query(`UPDATE portfolio_rds SET rd_number = :rdRef WHERE id = :id`, {
    rdRef,
    id: rdId,
  });

  let walletResult;
  try {
    walletResult = await investFromWallet({
      userId,
      investAmount: monthly,
      productType: "RD",
      productId: rdId,
      description: `DEMO RD first installment ${rdRef}`,
    });
  } catch (e) {
    await pool.query(`DELETE FROM portfolio_rds WHERE id = :id`, { id: rdId });
    throw e;
  }

  return demoEnvelope({
    message: "Demo RD started — first installment deducted from wallet",
    investment: {
      id: rdId,
      reference_number: rdRef,
      type: "RD",
      product: product.name,
      product_code: product.code,
      monthly_amount: monthly,
      interest_rate: rate,
      tenure_months: tenure,
      installments_paid: 1,
      total_deposit_so_far: monthly,
      start_date: start,
      next_installment_date: addMonths(start, 1),
      maturity_date: maturityDate,
      maturity_amount: maturityAmount,
      status: "ACTIVE",
      demo_label: product.demo_label,
    },
    wallet: {
      total_debited: walletResult.total_debited,
      balance: walletResult.balance,
    },
  });
}

async function listUserInvestments(userId, { type, status } = {}) {
  const [fds] = await pool.query(
    `SELECT * FROM portfolio_fds WHERE user_id = :userId ORDER BY id DESC`,
    { userId }
  );
  const [rds] = await pool.query(
    `SELECT * FROM portfolio_rds WHERE user_id = :userId ORDER BY id DESC`,
    { userId }
  );

  let items = [
    ...fds.map((f) => ({
      id: f.id,
      reference_number: f.fd_number || formatFdRef(f.id),
      type: "FD",
      product: f.bank_name,
      principal: Number(f.principal_amount),
      interest_rate: Number(f.interest_rate),
      tenure_months: Number(f.tenure_months),
      start_date: f.start_date,
      maturity_date: f.maturity_date,
      maturity_amount: Number(f.maturity_amount),
      status: String(f.status || "").toUpperCase(),
      demo_label: "Demo product — not an actual bank deposit.",
      created_at: f.created_at,
    })),
    ...rds.map((r) => ({
      id: r.id,
      reference_number: r.rd_number || formatRdRef(r.id),
      type: "RD",
      product: r.bank_name,
      principal: Number(r.monthly_amount),
      monthly_amount: Number(r.monthly_amount),
      interest_rate: Number(r.interest_rate),
      tenure_months: Number(r.tenure_months),
      installments_paid: Number(r.installments_paid || 1),
      start_date: r.start_date,
      maturity_date: r.maturity_date,
      maturity_amount: Number(r.maturity_amount),
      status: String(r.status || "").toUpperCase(),
      demo_label: "Demo product — not an actual bank deposit.",
      created_at: r.created_at,
    })),
  ];

  if (type) items = items.filter((i) => i.type === String(type).toUpperCase());
  if (status) items = items.filter((i) => i.status === String(status).toUpperCase());

  const activeFd = items.filter((i) => i.type === "FD" && i.status === "ACTIVE").length;
  const activeRd = items.filter((i) => i.type === "RD" && i.status === "ACTIVE").length;
  const matured = items.filter((i) => i.status === "MATURED").length;
  const totalInvested = items
    .filter((i) => i.status === "ACTIVE" || i.status === "MATURED")
    .reduce((s, i) => s + (i.type === "FD" ? i.principal : i.monthly_amount * (i.installments_paid || 1)), 0);

  return demoEnvelope({
    summary: {
      total_investments: items.length,
      active_fd: activeFd,
      active_rd: activeRd,
      matured_investments: matured,
      total_invested: roundMoney(totalInvested),
    },
    items,
  });
}

async function getUserInvestment(userId, type, id) {
  const t = String(type).toUpperCase();
  if (t === "FD") {
    const [rows] = await pool.query(
      `SELECT * FROM portfolio_fds WHERE id = :id AND user_id = :userId LIMIT 1`,
      { id, userId }
    );
    if (!rows.length) return null;
    const f = rows[0];
    return demoEnvelope({
      id: f.id,
      reference_number: f.fd_number || formatFdRef(f.id),
      type: "FD",
      product: f.bank_name,
      principal: Number(f.principal_amount),
      interest_rate: Number(f.interest_rate),
      tenure_months: Number(f.tenure_months),
      start_date: f.start_date,
      maturity_date: f.maturity_date,
      maturity_amount: Number(f.maturity_amount),
      status: String(f.status).toUpperCase(),
      notes: f.notes,
      demo_label: "Demo product — not an actual bank deposit.",
    });
  }
  const [rows] = await pool.query(
    `SELECT * FROM portfolio_rds WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id, userId }
  );
  if (!rows.length) return null;
  const r = rows[0];
  return demoEnvelope({
    id: r.id,
    reference_number: r.rd_number || formatRdRef(r.id),
    type: "RD",
    product: r.bank_name,
    monthly_amount: Number(r.monthly_amount),
    interest_rate: Number(r.interest_rate),
    tenure_months: Number(r.tenure_months),
    installments_paid: Number(r.installments_paid || 1),
    start_date: r.start_date,
    maturity_date: r.maturity_date,
    maturity_amount: Number(r.maturity_amount),
    status: String(r.status).toUpperCase(),
    demo_label: "Demo product — not an actual bank deposit.",
  });
}

/** Admin/UAT: mark FD matured and credit maturity to wallet once. */
async function matureFd(fdId, adminId) {
  const [rows] = await pool.query(`SELECT * FROM portfolio_fds WHERE id = :id LIMIT 1`, {
    id: fdId,
  });
  if (!rows.length) {
    const err = new Error("FD not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const fd = rows[0];
  if (fd.status !== "active") {
    const err = new Error(`FD already ${fd.status} — cannot mature twice`);
    err.code = "ALREADY_PROCESSED";
    throw err;
  }

  const principal = roundMoney(fd.principal_amount);
  const maturity = roundMoney(fd.maturity_amount);
  const interest = roundMoney(Math.max(0, maturity - principal));

  const settlement = await settleInvestmentToWallet({
    userId: fd.user_id,
    productType: "FD",
    productId: fd.id,
    principal,
    interestEarned: interest,
    lossAmount: 0,
    description: `DEMO FD maturity credit ${fd.fd_number || formatFdRef(fd.id)}`,
  });

  // Prefer INVESTMENT_RETURN label in meta
  await pool.query(
    `UPDATE wallet_transactions
     SET category = 'INVESTMENT_RETURN',
         meta_json = JSON_SET(COALESCE(meta_json, '{}'), '$.demo', true, '$.type', 'INVESTMENT_RETURN')
     WHERE id = :id`,
    { id: settlement.transaction_id }
  );

  await pool.query(
    `UPDATE portfolio_fds SET status = 'matured', updated_at = NOW() WHERE id = :id AND status = 'active'`,
    { id: fdId }
  );

  await writeAuditLog({
    userId: adminId,
    action: "DEMO_FD_MATURED",
    entityType: "portfolio_fd",
    entityId: fdId,
    meta: { user_id: fd.user_id, credited: settlement.credited },
  });

  return demoEnvelope({
    message: "FD marked matured — maturity amount credited to demo wallet",
    fd_id: fdId,
    reference_number: fd.fd_number || formatFdRef(fdId),
    credited: settlement.credited,
    wallet_balance: settlement.balance,
    status: "MATURED",
  });
}

async function matureRd(rdId, adminId) {
  const [rows] = await pool.query(`SELECT * FROM portfolio_rds WHERE id = :id LIMIT 1`, {
    id: rdId,
  });
  if (!rows.length) {
    const err = new Error("RD not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const rd = rows[0];
  if (rd.status !== "active") {
    const err = new Error(`RD already ${rd.status} — cannot mature twice`);
    err.code = "ALREADY_PROCESSED";
    throw err;
  }

  const paid = Number(rd.installments_paid || 1);
  const principal = roundMoney(Number(rd.monthly_amount) * paid);
  const maturity = roundMoney(rd.maturity_amount);
  // Pro-rate maturity if not all installments paid
  const fullPrincipal = roundMoney(Number(rd.monthly_amount) * Number(rd.tenure_months));
  const creditedMaturity =
    fullPrincipal > 0 ? roundMoney((maturity * principal) / fullPrincipal) : maturity;
  const interest = roundMoney(Math.max(0, creditedMaturity - principal));

  const settlement = await settleInvestmentToWallet({
    userId: rd.user_id,
    productType: "RD",
    productId: rd.id,
    principal,
    interestEarned: interest,
    lossAmount: 0,
    description: `DEMO RD maturity credit ${rd.rd_number || formatRdRef(rd.id)}`,
  });

  await pool.query(
    `UPDATE wallet_transactions
     SET category = 'INVESTMENT_RETURN',
         meta_json = JSON_SET(COALESCE(meta_json, '{}'), '$.demo', true, '$.type', 'INVESTMENT_RETURN')
     WHERE id = :id`,
    { id: settlement.transaction_id }
  );

  await pool.query(
    `UPDATE portfolio_rds SET status = 'matured', updated_at = NOW() WHERE id = :id AND status = 'active'`,
    { id: rdId }
  );

  await writeAuditLog({
    userId: adminId,
    action: "DEMO_RD_MATURED",
    entityType: "portfolio_rd",
    entityId: rdId,
    meta: { user_id: rd.user_id, credited: settlement.credited },
  });

  return demoEnvelope({
    message: "RD marked matured — amount credited to demo wallet",
    rd_id: rdId,
    reference_number: rd.rd_number || formatRdRef(rdId),
    credited: settlement.credited,
    wallet_balance: settlement.balance,
    status: "MATURED",
  });
}

/** Admin UAT: simulate next RD installment (debit wallet). */
async function simulateRdInstallment(rdId, adminId) {
  const [rows] = await pool.query(`SELECT * FROM portfolio_rds WHERE id = :id LIMIT 1`, {
    id: rdId,
  });
  if (!rows.length) {
    const err = new Error("RD not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const rd = rows[0];
  if (rd.status !== "active") {
    const err = new Error("RD is not active");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const paid = Number(rd.installments_paid || 1);
  if (paid >= Number(rd.tenure_months)) {
    const err = new Error("All installments already paid — mark RD as matured");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const monthly = roundMoney(rd.monthly_amount);
  const walletResult = await investFromWallet({
    userId: rd.user_id,
    investAmount: monthly,
    productType: "RD",
    productId: rd.id,
    description: `DEMO RD installment ${paid + 1}/${rd.tenure_months}`,
  });

  await pool.query(
    `UPDATE portfolio_rds SET installments_paid = :paid, updated_at = NOW() WHERE id = :id`,
    { paid: paid + 1, id: rdId }
  );

  await writeAuditLog({
    userId: adminId,
    action: "DEMO_RD_INSTALLMENT",
    entityType: "portfolio_rd",
    entityId: rdId,
    meta: { installment: paid + 1, amount: monthly },
  });

  return demoEnvelope({
    message: `Simulated installment ${paid + 1}/${rd.tenure_months}`,
    rd_id: rdId,
    installments_paid: paid + 1,
    tenure_months: Number(rd.tenure_months),
    wallet: {
      total_debited: walletResult.total_debited,
      balance: walletResult.balance,
    },
  });
}

module.exports = {
  DEMO_NOTICE,
  DEMO_CREDIT_PRESETS,
  DEMO_FD_PRODUCTS,
  DEMO_RD_PRODUCTS,
  isDemoModeEnabled,
  demoEnvelope,
  formatDemoTxnId,
  formatDemoWdId,
  mapLedgerType,
  calcFdMaturity,
  calcRdMaturity,
  getDemoWalletSummary,
  listDemoTransactions,
  addDemoMoney,
  listDemoProducts,
  estimateFd,
  estimateRd,
  createDemoFd,
  createDemoRd,
  listUserInvestments,
  getUserInvestment,
  matureFd,
  matureRd,
  simulateRdInstallment,
};
