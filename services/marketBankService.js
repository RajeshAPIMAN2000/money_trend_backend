const pool = require("../config/db");
const { FALLBACK_BANK_RATES } = require("./banks/fallbackRates");
const { formatTenureDisplay } = require("./fdRdRateProvider");

const PERIODS = {
  previous_month: 1,
  "1_year": 12,
  "3_years": 36,
  "5_years": 60,
  "10_years": 120,
};

const PERIOD_LABELS = {
  previous_month: "1-Month Interest Rate Trend",
  "1_year": "12-Month Interest Rate Trend",
  "3_years": "3-Year Interest Rate Trend",
  "5_years": "5-Year Interest Rate Trend",
  "10_years": "10-Year Interest Rate Trend",
};

/** RBI repo timeline — used for indicative history when snapshots are sparse. */
const RBI_REPO_RATE_HISTORY = [
  { date: "2015-06-02", rate: 7.25 },
  { date: "2020-05-22", rate: 4.0 },
  { date: "2023-02-08", rate: 6.5 },
  { date: "2025-06-06", rate: 5.5 },
];

function repoRateOn(date) {
  let current = RBI_REPO_RATE_HISTORY[0].rate;
  for (const point of RBI_REPO_RATE_HISTORY) {
    if (new Date(point.date) <= date) current = point.rate;
    else break;
  }
  return current;
}

function mapBankRow(row) {
  return {
    id: row.id,
    bankCode: row.bank_code,
    bankName: row.bank_name,
    bankType: row.bank_type,
    status: row.status,
  };
}

async function seedMarketBanks() {
  for (const bank of Object.values(FALLBACK_BANK_RATES)) {
    await pool.query(
      `INSERT INTO market_banks (bank_code, bank_name, bank_type, status)
       VALUES (:bankCode, :bankName, :bankType, 'active')
       ON DUPLICATE KEY UPDATE
         bank_name = VALUES(bank_name),
         bank_type = VALUES(bank_type),
         status = 'active'`,
      {
        bankCode: bank.bank_code,
        bankName: bank.bank,
        bankType: bank.type,
      }
    );
  }
}

async function listMarketBanks() {
  const [rows] = await pool.query(
    `SELECT id, bank_code, bank_name, bank_type, status
     FROM market_banks
     WHERE status = 'active'
     ORDER BY bank_name ASC`
  );
  return rows.map(mapBankRow);
}

async function getMarketBankById(id) {
  const [rows] = await pool.query(
    `SELECT id, bank_code, bank_name, bank_type, status
     FROM market_banks WHERE id = :id LIMIT 1`,
    { id }
  );
  if (!rows.length) return null;
  return mapBankRow(rows[0]);
}

async function getMarketBankByCode(bankCode) {
  const [rows] = await pool.query(
    `SELECT id, bank_code, bank_name, bank_type, status
     FROM market_banks WHERE bank_code = :bankCode LIMIT 1`,
    { bankCode: String(bankCode).toLowerCase() }
  );
  if (!rows.length) return null;
  return mapBankRow(rows[0]);
}

function groupRatesByProduct(rows, category = null) {
  const fd = [];
  const rd = [];
  for (const row of rows) {
    if (category && row.customerCategory !== category) continue;
    const item = {
      id: row.id,
      interestRate: row.interestRate,
      tenure: row.tenure,
      tenureUnit: row.tenureUnit,
      tenureDisplay: row.tenureDisplay,
      tenureLabel: row.tenureLabel || `${row.tenure}_${row.tenureUnit}`,
      customerCategory: row.customerCategory,
      minDeposit: row.minDeposit,
      maxDeposit: row.maxDeposit,
      effectiveDate: row.effectiveDate,
      source: row.source,
    };
    if (row.productType === "FD") fd.push(item);
    if (row.productType === "RD") rd.push(item);
  }
  fd.sort((a, b) => b.interestRate - a.interestRate);
  rd.sort((a, b) => b.interestRate - a.interestRate);
  return { fd, rd };
}

async function getBankRates(bankId, filters = {}) {
  const bank = await getMarketBankById(bankId);
  if (!bank) {
    const err = new Error("Bank not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT * FROM fd_rd_rates
     WHERE bank_code = :bankCode
       AND status = 'active'
       AND effective_date <= CURDATE()
       AND (expiry_date IS NULL OR expiry_date >= CURDATE())
       ${filters.category ? "AND customer_category = :category" : ""}
     ORDER BY product_type ASC, interest_rate DESC`,
    {
      bankCode: bank.bankCode,
      category: filters.category || null,
    }
  );

  const mapped = rows.map((row) => ({
    id: row.id,
    bankName: row.bank_name,
    bankCode: row.bank_code,
    productType: row.product_type,
    interestRate: Number(row.interest_rate),
    tenure: Number(row.tenure),
    tenureUnit: row.tenure_unit,
    tenureDisplay: formatTenureDisplay(row.tenure, row.tenure_unit),
    tenureLabel: row.tenure_label,
    minDeposit: row.min_deposit != null ? Number(row.min_deposit) : null,
    maxDeposit: row.max_deposit != null ? Number(row.max_deposit) : null,
    customerCategory: row.customer_category,
    effectiveDate: row.effective_date,
    source: row.source,
  }));

  const { fd, rd } = groupRatesByProduct(mapped, filters.category);

  return {
    bank,
    fd,
    rd,
    updatedAt: new Date().toISOString(),
  };
}

function buildIndicativeBankHistory(bankCode, months, productType, tenureLabel = "1_year") {
  const spreadByBank = { sbi: 1.2, hdfc: 1.35, icici: 1.3, axis: 1.35, pnb: 1.25, bob: 1.25, kotak: 1.3 };
  const spread = spreadByBank[bankCode] || 1.2;
  const offset = productType === "RD" ? -0.1 : 0;
  const series = [];
  const now = new Date();

  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const repo = repoRateOn(d);
    series.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      productType,
      tenureLabel,
      interestRate: Math.round((repo + spread + offset) * 100) / 100,
      source: "indicative",
    });
  }
  return series;
}

function tenureLabelToMonths(tenureLabel) {
  const label = String(tenureLabel || "1_year").toLowerCase();
  const match = label.match(/(\d+)/);
  const n = match ? Number(match[1]) : 1;
  if (label.includes("month")) return n;
  if (label.includes("day")) return Math.max(1, Math.round(n / 30));
  return n * 12;
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function calcFdMaturity(principal, ratePercent, tenureMonths) {
  const P = Number(principal);
  const r = Number(ratePercent) / 100;
  const years = Number(tenureMonths) / 12;
  const n = 4;
  const maturity = P * Math.pow(1 + r / n, n * years);
  return Math.round(maturity * 100) / 100;
}

function calcRdMaturity(monthlyAmount, ratePercent, tenureMonths) {
  const R = Number(monthlyAmount);
  const i = Number(ratePercent) / 400;
  const n = Number(tenureMonths);
  if (i === 0) return Math.round(R * n * 100) / 100;
  const maturity = R * ((Math.pow(1 + i, n) - 1) / i);
  return Math.round(maturity * 100) / 100;
}

function buildIndicativeMonthlyRates(bankCode, months, tenureLabel = "1_year") {
  const fdSeries = buildIndicativeBankHistory(bankCode, months, "FD", tenureLabel);
  const rdSeries = buildIndicativeBankHistory(bankCode, months, "RD", tenureLabel);
  const byMonth = new Map();

  for (const point of fdSeries) {
    byMonth.set(point.month, { month: point.month, fd_rate: point.interestRate, rd_rate: null });
  }
  for (const point of rdSeries) {
    const existing = byMonth.get(point.month) || { month: point.month, fd_rate: null, rd_rate: null };
    existing.rd_rate = point.interestRate;
    byMonth.set(point.month, existing);
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function aggregateSnapshotsToMonthly(snapshots, tenureLabel) {
  const byMonth = new Map();
  for (const row of snapshots) {
    if (tenureLabel && row.tenure_label !== tenureLabel) continue;
    const month = toDateStr(row.snapshot_date).slice(0, 7);
    const key = row.product_type === "FD" ? "fd_rate" : "rd_rate";
    const existing = byMonth.get(month) || { month, fd_rate: null, rd_rate: null };
    existing[key] = Number(row.interest_rate);
    byMonth.set(month, existing);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function buildInvestmentPoint(monthlyRates, tenureMonths, principal, monthlyAmount) {
  const fdRate = monthlyRates.fd_rate ?? 0;
  const rdRate = monthlyRates.rd_rate ?? 0;
  const fdMaturity = fdRate > 0 ? calcFdMaturity(principal, fdRate, tenureMonths) : null;
  const rdMaturity = rdRate > 0 ? calcRdMaturity(monthlyAmount, rdRate, tenureMonths) : null;

  return {
    month: monthlyRates.month,
    label: formatMonthLabel(monthlyRates.month),
    fd_rate: fdRate || null,
    rd_rate: rdRate || null,
    fd_maturity_value: fdMaturity,
    rd_maturity_value: rdMaturity,
    fd_interest_earned: fdMaturity != null ? Math.round((fdMaturity - principal) * 100) / 100 : null,
    rd_interest_earned:
      rdMaturity != null
        ? Math.round((rdMaturity - monthlyAmount * tenureMonths) * 100) / 100
        : null,
  };
}

function buildGraphPayload(monthlyRateRows, options = {}) {
  const principal = Number(options.principal) || 100000;
  const monthlyAmount = Number(options.monthlyAmount) || 5000;
  const tenureMonths = Number(options.tenureMonths) || 12;
  const productType = options.productType ? String(options.productType).toUpperCase() : null;

  const points = monthlyRateRows.map((row) =>
    buildInvestmentPoint(row, tenureMonths, principal, monthlyAmount)
  );

  const labels = points.map((p) => p.label);
  const monthKeys = points.map((p) => p.month);

  const fdRateSeries = {
    key: "fd_rate",
    label: "FD Interest Rate (%)",
    type: "line",
    yAxis: "rate",
    unit: "%",
    color: "#2563eb",
    data: points.map((p) => p.fd_rate),
  };
  const rdRateSeries = {
    key: "rd_rate",
    label: "RD Interest Rate (%)",
    type: "line",
    yAxis: "rate",
    unit: "%",
    color: "#16a34a",
    data: points.map((p) => p.rd_rate),
  };
  const fdValueSeries = {
    key: "fd_maturity_value",
    label: `FD Maturity (₹${principal.toLocaleString("en-IN")})`,
    type: "area",
    yAxis: "amount",
    unit: "INR",
    color: "#7c3aed",
    data: points.map((p) => p.fd_maturity_value),
  };
  const rdValueSeries = {
    key: "rd_maturity_value",
    label: `RD Maturity (₹${monthlyAmount.toLocaleString("en-IN")}/mo)`,
    type: "area",
    yAxis: "amount",
    unit: "INR",
    color: "#ea580c",
    data: points.map((p) => p.rd_maturity_value),
  };

  let series = [fdRateSeries, rdRateSeries, fdValueSeries, rdValueSeries];
  if (productType === "FD") {
    series = [fdRateSeries, fdValueSeries];
  } else if (productType === "RD") {
    series = [rdRateSeries, rdValueSeries];
  }

  const rateValues = points.flatMap((p) => [p.fd_rate, p.rd_rate]).filter((v) => v != null);
  const amountValues = points
    .flatMap((p) => [p.fd_maturity_value, p.rd_maturity_value])
    .filter((v) => v != null);

  const latest = points[points.length - 1] || {};

  return {
    labels,
    monthKeys,
    xAxis: { label: "Month", type: "category" },
    yAxes: {
      rate: {
        label: "Interest Rate (%)",
        position: "left",
        min: 0,
        max: rateValues.length ? Math.ceil(Math.max(...rateValues) + 1) : 10,
      },
      amount: {
        label: "Projected Value (₹)",
        position: "right",
        min: 0,
        max: amountValues.length ? Math.ceil(Math.max(...amountValues) * 1.05) : principal * 1.2,
      },
    },
    series,
    points,
    snapshot: {
      as_of: latest.month || null,
      fd_rate: latest.fd_rate ?? null,
      rd_rate: latest.rd_rate ?? null,
      fd_maturity_value: latest.fd_maturity_value ?? null,
      rd_maturity_value: latest.rd_maturity_value ?? null,
      fd_interest_earned: latest.fd_interest_earned ?? null,
      rd_interest_earned: latest.rd_interest_earned ?? null,
    },
    investment_inputs: {
      principal,
      monthly_amount: monthlyAmount,
      tenure_months: tenureMonths,
      product_type: productType || "BOTH",
    },
  };
}

async function getBankRateHistory(bankId, options = {}) {
  const bank = await getMarketBankById(bankId);
  if (!bank) {
    const err = new Error("Bank not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const periodKey = String(options.period || "1_year").toLowerCase();
  if (!PERIODS[periodKey]) {
    const err = new Error(`Invalid period. Use one of: ${Object.keys(PERIODS).join(", ")}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const tenureLabel = String(options.tenure || options.tenureLabel || "1_year");
  const tenureMonths = tenureLabelToMonths(tenureLabel);
  const category = options.category || "regular";
  const months = PERIODS[periodKey];
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().slice(0, 10);

  const [snapshots] = await pool.query(
    `SELECT snapshot_date, product_type, tenure_label, interest_rate, customer_category, source
     FROM fd_rd_rate_history
     WHERE bank_code = :bankCode
       AND snapshot_date >= :since
       AND customer_category = :category
       AND tenure_label = :tenureLabel
     ORDER BY snapshot_date ASC`,
    { bankCode: bank.bankCode, since: sinceStr, category, tenureLabel }
  );

  let monthlyRates;
  let dataSource;

  if (snapshots.length > 0) {
    monthlyRates = aggregateSnapshotsToMonthly(snapshots, tenureLabel);
    dataSource = "sync_snapshots";
  } else {
    monthlyRates = buildIndicativeMonthlyRates(bank.bankCode, months, tenureLabel);
    dataSource = "indicative_rbi_spread";
  }

  const graph = buildGraphPayload(monthlyRates, {
    principal: options.principal,
    monthlyAmount: options.monthlyAmount,
    tenureMonths,
    productType: options.productType,
  });

  return {
    bank,
    period: periodKey,
    period_label: PERIOD_LABELS[periodKey],
    period_months: PERIODS[periodKey],
    tenure: tenureLabel,
    tenure_months: tenureMonths,
    category,
    source: dataSource,
    graph,
  };
}

async function getBankRateHistoryAllPeriods(bankId, options = {}) {
  const graphs = {};
  for (const key of Object.keys(PERIODS)) {
    const result = await getBankRateHistory(bankId, { ...options, period: key });
    graphs[key] = {
      period: key,
      period_label: PERIOD_LABELS[key],
      graph: result.graph,
      source: result.source,
    };
  }
  const bank = await getMarketBankById(bankId);
  return { bank, graphs };
}

/** 12-month (or custom period) interest rate trend for every bank — graph-ready */
async function getAllBanksRateTrend(options = {}) {
  const periodKey = String(options.period || "1_year").toLowerCase();
  if (!PERIODS[periodKey]) {
    const err = new Error(`Invalid period. Use one of: ${Object.keys(PERIODS).join(", ")}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const banks = await listMarketBanks();
  const trendOptions = {
    period: periodKey,
    tenure: options.tenure || options.tenureLabel || "1_year",
    category: options.category || "regular",
    productType: options.productType || null,
    principal: options.principal,
    monthlyAmount: options.monthlyAmount,
  };

  const bankTrends = [];
  for (const bank of banks) {
    const result = await getBankRateHistory(bank.id, trendOptions);
    bankTrends.push({
      bank: result.bank,
      source: result.source,
      graph: result.graph,
    });
  }

  const sharedLabels = bankTrends[0]?.graph?.labels || [];

  return {
    period: periodKey,
    period_label: PERIOD_LABELS[periodKey],
    period_months: PERIODS[periodKey],
    tenure: trendOptions.tenure,
    category: trendOptions.category,
    labels: sharedLabels,
    month_keys: bankTrends[0]?.graph?.monthKeys || [],
    banks: bankTrends,
    total_banks: bankTrends.length,
  };
}

function toDateStr(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const BANK_CHART_COLORS = [
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
];

function pickBankColor(index) {
  return BANK_CHART_COLORS[index % BANK_CHART_COLORS.length];
}

async function resolveBanksForComparison(bankIds) {
  const allBanks = await listMarketBanks();
  if (!bankIds?.length) return allBanks;

  const idSet = new Set(bankIds.map(Number).filter(Boolean));
  const filtered = allBanks.filter((b) => idSet.has(b.id));
  if (!filtered.length) {
    const err = new Error("No valid banks found for comparison");
    err.code = "NOT_FOUND";
    throw err;
  }
  return filtered;
}

function extractRateSeries(graph, productType) {
  const rateKey = productType === "RD" ? "rd_rate" : "fd_rate";
  return graph.points.map((p) => p[rateKey]);
}

function extractMaturitySeries(graph, productType) {
  const valueKey = productType === "RD" ? "rd_maturity_value" : "fd_maturity_value";
  return graph.points.map((p) => p[valueKey]);
}

function average(values) {
  const nums = values.filter((v) => v != null && !Number.isNaN(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100;
}

/**
 * Multi-bank fund performance comparison — single graph with one line per bank.
 */
async function getFundPerformanceComparison(options = {}) {
  const periodKey = String(options.period || "1_year").toLowerCase();
  if (!PERIODS[periodKey]) {
    const err = new Error(`Invalid period. Use one of: ${Object.keys(PERIODS).join(", ")}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const productType = String(options.productType || options.type || "FD").toUpperCase();
  if (!["FD", "RD"].includes(productType)) {
    const err = new Error("type must be FD or RD");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const bankIds = options.bankIds?.length
    ? options.bankIds
    : String(options.bank_ids || options.bankIds || "")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter(Boolean);

  const banks = await resolveBanksForComparison(bankIds);
  const trendOptions = {
    period: periodKey,
    tenure: options.tenure || options.tenureLabel || "1_year",
    category: options.category || "regular",
    productType,
    principal: options.principal,
    monthlyAmount: options.monthlyAmount,
  };

  const rateSeriesList = [];
  const valueSeriesList = [];
  const comparison = [];
  let labels = [];
  let monthKeys = [];

  for (let i = 0; i < banks.length; i++) {
    const bank = banks[i];
    const result = await getBankRateHistory(bank.id, trendOptions);
    if (i === 0) {
      labels = result.graph.labels;
      monthKeys = result.graph.monthKeys;
    }
    const color = pickBankColor(i);
    const rates = extractRateSeries(result.graph, productType);
    const values = extractMaturitySeries(result.graph, productType);
    const currentRate = rates.filter((v) => v != null).at(-1) ?? null;
    const currentValue = values.filter((v) => v != null).at(-1) ?? null;

    rateSeriesList.push({
      bank_id: bank.id,
      bank_code: bank.bankCode,
      bank_name: bank.bankName,
      key: `${bank.bankCode}_rate`,
      label: `${bank.bankName} ${productType} Rate`,
      type: "line",
      yAxis: "rate",
      unit: "%",
      color,
      data: rates,
      source: result.source,
    });

    valueSeriesList.push({
      bank_id: bank.id,
      bank_code: bank.bankCode,
      bank_name: bank.bankName,
      key: `${bank.bankCode}_value`,
      label: `${bank.bankName} Projected Value`,
      type: "line",
      yAxis: "amount",
      unit: "INR",
      color,
      data: values,
      source: result.source,
    });

    comparison.push({
      bank_id: bank.id,
      bank_code: bank.bankCode,
      bank_name: bank.bankName,
      bank_type: bank.bankType,
      current_rate: currentRate,
      average_rate: average(rates),
      projected_value: currentValue,
      projected_interest:
        productType === "FD" && currentValue != null
          ? Math.round((currentValue - (Number(options.principal) || 100000)) * 100) / 100
          : productType === "RD" && currentValue != null
            ? Math.round(
                (currentValue -
                  (Number(options.monthlyAmount) || 5000) *
                    (Number(options.tenureMonths) || tenureLabelToMonths(trendOptions.tenure))) *
                  100
              ) / 100
            : null,
      data_source: result.source,
    });
  }

  comparison.sort((a, b) => (b.current_rate || 0) - (a.current_rate || 0));
  comparison.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const allRates = rateSeriesList.flatMap((s) => s.data).filter((v) => v != null);
  const allValues = valueSeriesList.flatMap((s) => s.data).filter((v) => v != null);
  const principal = Number(options.principal) || 100000;

  return {
    title: `${productType} Fund Performance — Bank Comparison`,
    subtitle: PERIOD_LABELS[periodKey],
    period: periodKey,
    period_label: PERIOD_LABELS[periodKey],
    period_months: PERIODS[periodKey],
    product_type: productType,
    tenure: trendOptions.tenure,
    category: trendOptions.category,
    labels,
    month_keys: monthKeys,
    x_axis: { label: "Month", type: "category" },
    y_axes: {
      rate: {
        label: "Interest Rate (%)",
        position: "left",
        min: 0,
        max: allRates.length ? Math.ceil(Math.max(...allRates) + 1) : 10,
      },
      amount: {
        label: "Projected Value (₹)",
        position: "right",
        min: 0,
        max: allValues.length ? Math.ceil(Math.max(...allValues) * 1.05) : principal * 1.2,
      },
    },
    charts: {
      rate_comparison: {
        title: `${productType} Interest Rate Comparison`,
        type: "line",
        labels,
        series: rateSeriesList,
        y_axis: "rate",
      },
      value_comparison: {
        title: `${productType} Projected Returns Comparison`,
        type: "line",
        labels,
        series: valueSeriesList,
        y_axis: "amount",
      },
    },
    comparison_table: comparison,
    investment_inputs: {
      principal: Number(options.principal) || 100000,
      monthly_amount: Number(options.monthlyAmount) || 5000,
      tenure: trendOptions.tenure,
      tenure_months: tenureLabelToMonths(trendOptions.tenure),
    },
    total_banks: banks.length,
  };
}

async function getFundPerformanceByBankId(bankId, options = {}) {
  const productType = String(options.productType || options.type || "FD").toUpperCase();
  const period = String(options.period || "1_year").toLowerCase();

  const history = await getBankRateHistory(bankId, {
    period,
    tenure: options.tenure || options.tenureLabel || "1_year",
    category: options.category || "regular",
    productType,
    principal: options.principal,
    monthlyAmount: options.monthlyAmount,
  });

  const rates = extractRateSeries(history.graph, productType);
  const values = extractMaturitySeries(history.graph, productType);

  return {
    bank: history.bank,
    period: history.period,
    period_label: history.period_label,
    product_type: productType,
    tenure: history.tenure,
    source: history.source,
    chart: {
      title: `${history.bank.bankName} — ${productType} Performance`,
      labels: history.graph.labels,
      series:
        productType === "RD"
          ? history.graph.series.filter((s) => s.key.includes("rd"))
          : history.graph.series.filter((s) => s.key.includes("fd")),
      y_axes: history.graph.yAxes,
      points: history.graph.points,
    },
    snapshot: {
      current_rate: rates.filter((v) => v != null).at(-1) ?? null,
      average_rate: average(rates),
      projected_value: values.filter((v) => v != null).at(-1) ?? null,
      ...history.graph.snapshot,
    },
    investment_inputs: history.graph.investment_inputs,
  };
}

async function recordRateHistorySnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO fd_rd_rate_history
      (bank_code, product_type, tenure_label, interest_rate, customer_category, snapshot_date, source)
     SELECT bank_code, product_type, tenure_label, interest_rate, customer_category, :today, source
     FROM fd_rd_rates
     WHERE status = 'active'
     ON DUPLICATE KEY UPDATE
       interest_rate = VALUES(interest_rate),
       source = VALUES(source)`,
    { today }
  );
}

async function enrichBanksWithIds(bankCards = []) {
  const banks = await listMarketBanks();
  const byCode = new Map(banks.map((b) => [b.bankCode, b.id]));
  return bankCards.map((card) => ({
    ...card,
    id: byCode.get(card.bank_code) || null,
  }));
}

module.exports = {
  PERIODS,
  seedMarketBanks,
  listMarketBanks,
  getMarketBankById,
  getMarketBankByCode,
  getBankRates,
  getBankRateHistory,
  getBankRateHistoryAllPeriods,
  getAllBanksRateTrend,
  getFundPerformanceComparison,
  getFundPerformanceByBankId,
  recordRateHistorySnapshot,
  enrichBanksWithIds,
  buildGraphPayload,
  tenureLabelToMonths,
  PERIOD_LABELS,
};
