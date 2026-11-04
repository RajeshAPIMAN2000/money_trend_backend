const XLSX = require("xlsx");
const pool = require("../config/db");
const { getAdminDashboard } = require("./adminDashboardService");
const { decryptPii, maskPan, maskAadhaar } = require("../utils/security");

const EXPORT_TYPES = {
  dashboard: { label: "Dashboard", group: "Dashboard" },
  users: { label: "Users", group: "Users" },
  "kyc-verification": { label: "KYC Verification", group: "Users" },
  "user-activity": { label: "User Activity", group: "Users" },
  "user-documents": { label: "User Documents", group: "Users" },
  "roles-permissions": { label: "Roles & Permissions", group: "Users" },
  stocks: { label: "Stocks", group: "Investments" },
  "mutual-funds": { label: "Mutual Funds", group: "Investments" },
  "fixed-deposits": { label: "Fixed Deposits", group: "Investments" },
  "recurring-deposits": { label: "Recurring Deposits", group: "Investments" },
  "sip-investments": { label: "SIP Investments", group: "Investments" },
  portfolio: { label: "Portfolio", group: "Investments" },
  deposits: { label: "Deposits", group: "Transactions" },
  withdrawals: { label: "Withdrawals", group: "Transactions" },
  orders: { label: "Orders", group: "Transactions" },
  "transaction-history": { label: "Transaction History", group: "Transactions" },
  "market-overview": { label: "Market Overview", group: "Market & Data" },
  indices: { label: "Indices", group: "Market & Data" },
  commodities: { label: "Commodities", group: "Market & Data" },
};

function normalizeType(type) {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function getExportLimit(query) {
  return Math.min(Math.max(Number(query.limit) || 5000, 1), 10000);
}

function flattenRow(obj, prefix = "") {
  const row = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const col = prefix ? `${prefix}_${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(row, flattenRow(value, col));
    } else if (Array.isArray(value)) {
      row[col] = JSON.stringify(value);
    } else {
      row[col] = value;
    }
  }
  return row;
}

function rowsToSheet(rows) {
  if (!rows.length) return [{ note: "No records found" }];
  return rows.map((r) => flattenRow(r));
}

function escapeCsvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(rows) {
  const sheet = rowsToSheet(rows);
  const headers = [...new Set(sheet.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(",")];
  for (const row of sheet) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

function toXlsxBuffer(rows, sheetName = "Export") {
  const sheet = rowsToSheet(rows);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheet);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function fetchDashboardRows(query) {
  const data = await getAdminDashboard(query);
  const rows = [];

  for (const [key, card] of Object.entries(data.summary_cards || {})) {
    if (key === "date_range") continue;
    rows.push({
      section: "Summary",
      metric: card.label || key,
      value: card.display ?? card.value,
      growth_percent: card.growth_percent ?? "",
    });
  }

  for (const [key, card] of Object.entries(data.activity_cards || {})) {
    rows.push({
      section: "Activity",
      metric: card.label || key,
      value: card.display ?? card.value,
      growth_percent: "",
    });
  }

  for (const tx of data.recent_transactions || []) {
    rows.push({
      section: "Recent Transaction",
      metric: tx.user_name,
      value: tx.amount_display,
      growth_percent: tx.description,
    });
  }

  rows.push({
    section: "Meta",
    metric: "Generated At",
    value: data.generated_at,
    growth_percent: data.date_range?.label || "",
  });

  return rows;
}

async function fetchUsersRows(query) {
  const limit = getExportLimit(query);
  const status = String(query.kyc_status || query.status || "").trim().toLowerCase();
  const params = { limit };
  let where = `WHERE u.role = 'user'`;
  if (status && ["pending", "submitted", "verified", "rejected"].includes(status)) {
    where += ` AND u.kyc_status = :status`;
    params.status = status;
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.date_of_birth, u.role,
            u.kyc_status, u.kyc_method, u.created_at, u.updated_at
     FROM users u ${where}
     ORDER BY u.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return rows;
}

async function fetchKycVerificationRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.email, u.phone, u.kyc_status,
            k.method AS kyc_method, k.status AS document_status,
            k.pan_full_name, k.pan_number, k.aadhaar_number,
            k.digilocker_ref, k.created_at AS submitted_at, k.updated_at AS reviewed_at
     FROM users u
     LEFT JOIN kyc_documents k ON k.user_id = u.id
     WHERE u.role = 'user'
     ORDER BY k.created_at DESC, u.created_at DESC
     LIMIT ${limit}`
  );

  return rows.map((r) => ({
    ...r,
    pan_number: maskPan(decryptPii(r.pan_number) || r.pan_number),
    aadhaar_number: maskAadhaar(decryptPii(r.aadhaar_number) || r.aadhaar_number),
  }));
}

async function fetchUserActivityRows(query) {
  const limit = getExportLimit(query);
  const [auditRows] = await pool.query(
    `SELECT a.id, a.user_id, u.full_name, u.email, a.action, a.entity_type,
            a.entity_id, a.ip_address, a.created_at
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT ${limit}`
  );

  const [txRows] = await pool.query(
    `SELECT wt.id, wt.user_id, u.full_name, u.email, wt.direction, wt.category,
            wt.amount, wt.balance_after, wt.description, wt.created_at
     FROM wallet_transactions wt
     JOIN users u ON u.id = wt.user_id
     ORDER BY wt.created_at DESC
     LIMIT ${limit}`
  );

  return [
    ...auditRows.map((r) => ({ activity_type: "audit", ...r })),
    ...txRows.map((r) => ({ activity_type: "wallet_transaction", ...r })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function fetchUserDocumentsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.email, u.phone,
            k.method, k.status, k.pan_full_name, k.pan_number, k.pan_image,
            k.aadhaar_number, k.aadhaar_image, k.digilocker_ref,
            k.created_at, k.updated_at
     FROM kyc_documents k
     JOIN users u ON u.id = k.user_id
     ORDER BY k.updated_at DESC
     LIMIT ${limit}`
  );

  return rows.map((r) => ({
    ...r,
    pan_number: maskPan(decryptPii(r.pan_number) || r.pan_number),
    aadhaar_number: maskAadhaar(decryptPii(r.aadhaar_number) || r.aadhaar_number),
  }));
}

async function fetchRolesPermissionsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, role, kyc_status, created_at, updated_at
     FROM users
     ORDER BY role DESC, created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchFixedDepositsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT f.id, f.user_id, u.full_name, u.email, f.bank_name, f.bank_code,
            f.fd_number, f.principal_amount, f.interest_rate, f.tenure_months,
            f.start_date, f.maturity_date, f.maturity_amount, f.compounding,
            f.status, f.created_at
     FROM portfolio_fds f
     JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchRecurringDepositsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT r.id, r.user_id, u.full_name, u.email, r.bank_name, r.bank_code,
            r.rd_number, r.monthly_amount, r.interest_rate, r.tenure_months,
            r.start_date, r.maturity_date, r.maturity_amount, r.status, r.created_at
     FROM portfolio_rds r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchSipInvestmentsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT r.id, r.user_id, u.full_name, u.email, r.bank_name, r.monthly_amount,
            r.interest_rate, r.tenure_months, r.maturity_amount, r.status,
            r.start_date, r.maturity_date, r.created_at
     FROM portfolio_rds r
     JOIN users u ON u.id = r.user_id
     WHERE r.status = 'active'
     ORDER BY r.created_at DESC
     LIMIT ${limit}`
  );
  return rows.map((r) => ({ ...r, investment_type: "SIP/RD" }));
}

async function fetchPortfolioRows(query) {
  const limit = getExportLimit(query);
  const [fds] = await pool.query(
    `SELECT f.id, f.user_id, u.full_name, u.email, 'FD' AS product_type,
            f.bank_name, f.principal_amount AS invested_amount, f.maturity_amount,
            f.interest_rate, f.tenure_months, f.status, f.created_at
     FROM portfolio_fds f
     JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC
     LIMIT ${limit}`
  );
  const [rds] = await pool.query(
    `SELECT r.id, r.user_id, u.full_name, u.email, 'RD' AS product_type,
            r.bank_name, (r.monthly_amount * r.tenure_months) AS invested_amount,
            r.maturity_amount, r.interest_rate, r.tenure_months, r.status, r.created_at
     FROM portfolio_rds r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC
     LIMIT ${limit}`
  );
  const [wallets] = await pool.query(
    `SELECT w.id, w.user_id, u.full_name, u.email, 'Wallet' AS product_type,
            'Wallet Balance' AS bank_name, w.balance AS invested_amount,
            w.balance AS maturity_amount, 0 AS interest_rate, 0 AS tenure_months,
            w.status, w.updated_at AS created_at
     FROM wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.balance > 0
     ORDER BY w.updated_at DESC
     LIMIT ${limit}`
  );

  return [...fds, ...rds, ...wallets].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

async function fetchDepositsRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT d.id, d.user_id, u.full_name, u.email, d.amount, d.currency,
            d.razorpay_order_id, d.razorpay_payment_id, d.status,
            d.credited_at, d.created_at
     FROM wallet_deposits d
     JOIN users u ON u.id = d.user_id
     ORDER BY d.created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchWithdrawalsRows(query) {
  const limit = getExportLimit(query);
  const status = String(query.status || "").trim().toLowerCase();
  const params = {};
  let where = "WHERE 1=1";
  if (status && ["pending", "approved", "rejected", "paid"].includes(status)) {
    where += " AND w.status = :status";
    params.status = status;
  }

  const [rows] = await pool.query(
    `SELECT w.id, w.user_id, u.full_name, u.email, u.phone, w.amount, w.status,
            w.admin_note, w.processed_at, w.created_at,
            b.bank_name, b.ifsc_code, b.account_last4
     FROM withdrawal_requests w
     JOIN users u ON u.id = w.user_id
     JOIN user_bank_accounts b ON b.id = w.bank_account_id
     ${where}
     ORDER BY w.created_at DESC
     LIMIT ${limit}`,
    params
  );
  return rows;
}

async function fetchOrdersRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT wt.id, wt.user_id, u.full_name, u.email, wt.direction, wt.category,
            wt.amount, wt.reference_type, wt.reference_id, wt.description,
            wt.created_at
     FROM wallet_transactions wt
     JOIN users u ON u.id = wt.user_id
     WHERE wt.category IN ('fd_invest', 'rd_invest', 'admin_commission')
     ORDER BY wt.created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchTransactionHistoryRows(query) {
  const limit = getExportLimit(query);
  const [rows] = await pool.query(
    `SELECT wt.id, wt.user_id, u.full_name, u.email, wt.direction, wt.category,
            wt.amount, wt.balance_after, wt.reference_type, wt.reference_id,
            wt.description, wt.created_at
     FROM wallet_transactions wt
     JOIN users u ON u.id = wt.user_id
     ORDER BY wt.created_at DESC
     LIMIT ${limit}`
  );
  return rows;
}

async function fetchMarketOverviewRows(query) {
  const data = await getAdminDashboard(query);
  const rows = [];
  const market = data.charts?.market_overview;

  if (market?.labels?.length) {
    market.labels.forEach((label, idx) => {
      for (const series of market.series || []) {
        rows.push({
          month: label,
          index_name: series.name,
          value: series.data?.[idx] ?? "",
        });
      }
    });
  }

  for (const item of data.top_performing_investments || []) {
    rows.push({
      month: "",
      index_name: item.name,
      value: item.return_percent,
      note: "Top performing investment",
    });
  }

  return rows.length ? rows : [{ note: "No market overview data" }];
}

async function fetchIndicesRows() {
  const data = await getAdminDashboard({});
  return (data.market_indices || []).map((item) => ({
    name: item.name,
    key: item.key,
    value: item.value,
    value_display: item.value_display,
    change_percent: item.change_percent,
    change_display: item.change_display,
    direction: item.direction,
  }));
}

async function fetchCommoditiesRows() {
  const data = await getAdminDashboard({});
  const commodityKeys = ["gold", "silver", "usd_inr"];
  return (data.market_indices || [])
    .filter((item) => commodityKeys.includes(item.key))
    .map((item) => ({
      name: item.name,
      value: item.value,
      value_display: item.value_display,
      change_percent: item.change_percent,
      direction: item.direction,
    }));
}

async function fetchStocksRows() {
  return [
    {
      note: "Stocks module is not configured yet. Connect NSE/BSE integration to export live stock data.",
    },
  ];
}

async function fetchMutualFundsRows() {
  return [
    {
      note: "Mutual Funds module is not configured yet. Connect AMC integration to export mutual fund data.",
    },
  ];
}

const FETCHERS = {
  dashboard: fetchDashboardRows,
  users: fetchUsersRows,
  "kyc-verification": fetchKycVerificationRows,
  "user-activity": fetchUserActivityRows,
  "user-documents": fetchUserDocumentsRows,
  "roles-permissions": fetchRolesPermissionsRows,
  stocks: fetchStocksRows,
  "mutual-funds": fetchMutualFundsRows,
  "fixed-deposits": fetchFixedDepositsRows,
  "recurring-deposits": fetchRecurringDepositsRows,
  "sip-investments": fetchSipInvestmentsRows,
  portfolio: fetchPortfolioRows,
  deposits: fetchDepositsRows,
  withdrawals: fetchWithdrawalsRows,
  orders: fetchOrdersRows,
  "transaction-history": fetchTransactionHistoryRows,
  "market-overview": fetchMarketOverviewRows,
  indices: fetchIndicesRows,
  commodities: fetchCommoditiesRows,
};

function listExportTypes() {
  return Object.entries(EXPORT_TYPES).map(([key, meta]) => ({
    key,
    label: meta.label,
    group: meta.group,
    formats: ["csv", "xlsx"],
    endpoints: {
      csv: `/api/admin/exports/${key}?format=csv`,
      xlsx: `/api/admin/exports/${key}?format=xlsx`,
    },
  }));
}

async function exportAdminData(type, query = {}) {
  const normalized = normalizeType(type);
  const meta = EXPORT_TYPES[normalized];
  if (!meta) {
    const err = new Error(`Invalid export type. Use GET /api/admin/exports/types for available types.`);
    err.code = "INVALID_TYPE";
    throw err;
  }

  const format = String(query.format || "csv").toLowerCase();
  if (!["csv", "xlsx"].includes(format)) {
    const err = new Error("format must be csv or xlsx");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const rows = await FETCHERS[normalized](query);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${normalized}-${timestamp}.${format === "xlsx" ? "xlsx" : "csv"}`;

  if (format === "xlsx") {
    return {
      type: normalized,
      label: meta.label,
      format,
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: toXlsxBuffer(rows, meta.label),
      row_count: rows.length,
    };
  }

  return {
    type: normalized,
    label: meta.label,
    format,
    filename,
    mimeType: "text/csv; charset=utf-8",
    content: toCsv(rows),
    row_count: rows.length,
  };
}

module.exports = {
  EXPORT_TYPES,
  listExportTypes,
  exportAdminData,
  normalizeType,
};
