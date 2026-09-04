const pool = require("../config/db");
const { writeAuditLog } = require("../utils/audit");
const { sanitizeText } = require("../utils/validators");
const {
  fetchRatesFromBankProvider,
  formatTenureDisplay,
} = require("./fdRdRateProvider");
const { recordRateHistorySnapshot } = require("./marketBankService");

const SYNC_SOURCES = ["bank_api", "fallback"];
const DEFAULT_TICKER_LIMIT = Number(process.env.FD_RD_TICKER_LIMIT || 10);
const CACHE_TTL_MS = Number(process.env.FD_RD_CACHE_TTL || 60) * 1000;

let tickerCache = { key: null, data: null, expiresAt: 0 };

function getDefaultLimit(limitParam) {
  const parsed = Number(limitParam);
  if (!Number.isNaN(parsed) && parsed > 0) return Math.min(parsed, 50);
  return DEFAULT_TICKER_LIMIT;
}

function toDateStr(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return str.slice(0, 10);
}

function isRateCurrentlyValid(row, today = new Date()) {
  if (row.status !== "active") return false;
  const todayStr = toDateStr(today);
  const effective = toDateStr(row.effective_date || row.effectiveDate);
  if (effective && effective > todayStr) return false;
  const expiry = toDateStr(row.expiry_date || row.expiryDate);
  if (expiry && expiry < todayStr) return false;
  return true;
}

function mapRowToTickerItem(row) {
  const { resolveBankLogo } = require("./banks/bankLogos");
  const logo = resolveBankLogo({ bankCode: row.bank_code, logoUrl: row.logo_url });
  return {
    bankName: row.bank_name,
    bankCode: row.bank_code,
    interestRate: Number(row.interest_rate),
    tenure: formatTenureDisplay(row.tenure, row.tenure_unit),
    tenureValue: Number(row.tenure),
    tenureUnit: row.tenure_unit,
    customerCategory: row.customer_category,
    logo,
    logo_url: logo,
    bank_logo: logo,
    icon: logo,
    icon_url: logo,
  };
}

function mapRowToPublic(row) {
  const { resolveBankLogo } = require("./banks/bankLogos");
  const logo = resolveBankLogo({ bankCode: row.bank_code, logoUrl: row.logo_url });
  return {
    id: row.id,
    bankName: row.bank_name,
    bankCode: row.bank_code,
    productType: row.product_type,
    interestRate: Number(row.interest_rate),
    tenure: Number(row.tenure),
    tenureUnit: row.tenure_unit,
    tenureDisplay: formatTenureDisplay(row.tenure, row.tenure_unit),
    minDeposit: row.min_deposit != null ? Number(row.min_deposit) : null,
    maxDeposit: row.max_deposit != null ? Number(row.max_deposit) : null,
    customerCategory: row.customer_category,
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    status: row.status,
    source: row.source,
    updatedAt: row.updated_at,
    logo,
    logo_url: logo,
    bank_logo: logo,
    icon: logo,
    icon_url: logo,
  };
}

function buildHighestRates(rows, { productType, limit, category, tenure, tenureUnit } = {}) {
  let filtered = rows.filter((row) => isRateCurrentlyValid(row));

  if (productType) {
    filtered = filtered.filter((r) => r.product_type === productType);
  }

  if (category) {
    filtered = filtered.filter((r) => r.customer_category === category);
  }

  if (tenure != null && tenureUnit) {
    filtered = filtered.filter(
      (r) => Number(r.tenure) === Number(tenure) && r.tenure_unit === tenureUnit
    );
  }

  const seen = new Set();
  const deduped = [];
  for (const row of filtered.sort((a, b) => Number(b.interest_rate) - Number(a.interest_rate))) {
    const key = `${row.bank_code}|${row.product_type}|${row.tenure_label}|${row.customer_category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function buildTickerPayload(rows, options = {}) {
  const limit = getDefaultLimit(options.limit);
  const category = options.category || null;
  const tenure = options.tenure != null ? Number(options.tenure) : null;
  const tenureUnit = options.tenureUnit || null;
  const type = options.type ? String(options.type).toUpperCase() : null;

  const fdRows = buildHighestRates(rows, {
    productType: "FD",
    limit,
    category,
    tenure,
    tenureUnit,
  });
  const rdRows = buildHighestRates(rows, {
    productType: "RD",
    limit,
    category,
    tenure,
    tenureUnit,
  });

  const payload = {
    fd: fdRows.map(mapRowToTickerItem),
    rd: rdRows.map(mapRowToTickerItem),
    updatedAt: new Date().toISOString(),
  };

  if (type === "FD") return { fd: payload.fd, updatedAt: payload.updatedAt };
  if (type === "RD") return { rd: payload.rd, updatedAt: payload.updatedAt };
  return payload;
}

function buildCacheKey(options) {
  return JSON.stringify({
    limit: options.limit || DEFAULT_TICKER_LIMIT,
    type: options.type || "ALL",
    category: options.category || "",
    tenure: options.tenure || "",
    tenureUnit: options.tenureUnit || "",
  });
}

async function listActiveRateRows() {
  const [rows] = await pool.query(
    `SELECT id, bank_name, bank_code, product_type, interest_rate, tenure, tenure_unit,
            tenure_label, min_deposit, max_deposit, customer_category, senior_citizen_extra,
            effective_date, expiry_date, status, source, created_at, updated_at
     FROM fd_rd_rates
     WHERE status = 'active'
       AND effective_date <= CURDATE()
       AND (expiry_date IS NULL OR expiry_date >= CURDATE())
     ORDER BY interest_rate DESC`
  );
  return rows;
}

async function getTicker(options = {}) {
  const cacheKey = buildCacheKey(options);
  const now = Date.now();
  if (tickerCache.key === cacheKey && tickerCache.expiresAt > now) {
    return tickerCache.data;
  }

  const rows = await listActiveRateRows();
  const data = buildTickerPayload(rows, options);
  tickerCache = { key: cacheKey, data, expiresAt: now + CACHE_TTL_MS };
  return data;
}

function invalidateTickerCache() {
  tickerCache = { key: null, data: null, expiresAt: 0 };
}

async function syncRatesFromProvider() {
  console.log("[RATES] Syncing FD/RD rates from bank provider...");
  try {
    const { records, meta } = await fetchRatesFromBankProvider();
    const today = new Date().toISOString().slice(0, 10);

    await pool.query(
      `UPDATE fd_rd_rates SET status = 'inactive', updated_at = NOW()
       WHERE source IN ('bank_api', 'fallback') AND status = 'active'`
    );

    for (const rec of records) {
      await pool.query(
        `INSERT INTO fd_rd_rates
          (bank_name, bank_code, product_type, interest_rate, tenure, tenure_unit, tenure_label,
           min_deposit, max_deposit, customer_category, senior_citizen_extra,
           effective_date, expiry_date, status, source)
         VALUES
          (:bankName, :bankCode, :productType, :interestRate, :tenure, :tenureUnit, :tenureLabel,
           :minDeposit, :maxDeposit, :customerCategory, :seniorCitizenExtra,
           :effectiveDate, :expiryDate, :status, :source)
         ON DUPLICATE KEY UPDATE
          bank_name = VALUES(bank_name),
          interest_rate = VALUES(interest_rate),
          tenure = VALUES(tenure),
          tenure_unit = VALUES(tenure_unit),
          min_deposit = VALUES(min_deposit),
          max_deposit = VALUES(max_deposit),
          senior_citizen_extra = VALUES(senior_citizen_extra),
          effective_date = VALUES(effective_date),
          expiry_date = VALUES(expiry_date),
          status = 'active',
          source = VALUES(source),
          updated_at = NOW()`,
        {
          bankName: rec.bankName,
          bankCode: rec.bankCode,
          productType: rec.productType,
          interestRate: rec.interestRate,
          tenure: rec.tenure,
          tenureUnit: rec.tenureUnit,
          tenureLabel: rec.tenureLabel,
          minDeposit: rec.minDeposit,
          maxDeposit: rec.maxDeposit,
          customerCategory: rec.customerCategory,
          seniorCitizenExtra: rec.seniorCitizenExtra,
          effectiveDate: rec.effectiveDate || today,
          expiryDate: rec.expiryDate,
          status: "active",
          source: rec.source,
        }
      );
    }

    invalidateTickerCache();
    await recordRateHistorySnapshot();
    console.log(
      `[RATES] Sync complete: ${records.length} rate rows (${meta.live_banks} live banks)`
    );
    return { synced: records.length, meta };
  } catch (error) {
    console.error("[RATES] Sync failed:", error.message);
    throw error;
  }
}

async function listRates(filters = {}) {
  const conditions = ["1=1"];
  const params = {};

  if (filters.productType) {
    conditions.push("product_type = :productType");
    params.productType = String(filters.productType).toUpperCase();
  }
  if (filters.status) {
    conditions.push("status = :status");
    params.status = filters.status;
  }
  if (filters.bankName) {
    conditions.push("bank_name LIKE :bankName");
    params.bankName = `%${filters.bankName}%`;
  }
  if (filters.bankCode) {
    conditions.push("bank_code = :bankCode");
    params.bankCode = String(filters.bankCode).toLowerCase();
  }
  if (filters.category) {
    conditions.push("customer_category = :category");
    params.category = filters.category;
  }

  const sortDir = filters.sort === "asc" ? "ASC" : "DESC";
  const [rows] = await pool.query(
    `SELECT * FROM fd_rd_rates
     WHERE ${conditions.join(" AND ")}
     ORDER BY interest_rate ${sortDir}, bank_name ASC`,
    params
  );
  return rows.map(mapRowToPublic);
}

async function getRateById(id) {
  const [rows] = await pool.query(`SELECT * FROM fd_rd_rates WHERE id = :id LIMIT 1`, { id });
  if (!rows.length) return null;
  return mapRowToPublic(rows[0]);
}

function validateRateInput(body, isUpdate = false) {
  const errors = [];
  const productType = String(body.productType || body.product_type || "").toUpperCase();
  const interestRate = Number(body.interestRate ?? body.interest_rate);
  const tenure = Number(body.tenure);
  const tenureUnit = String(body.tenureUnit || body.tenure_unit || "years").toLowerCase();
  const bankName = sanitizeText(body.bankName || body.bank_name, 150);
  const status = body.status ? String(body.status).toLowerCase() : "active";
  const category = String(
    body.customerCategory || body.customer_category || "regular"
  ).toLowerCase();

  if (!isUpdate && !bankName) errors.push("bankName is required");
  if (!isUpdate && !["FD", "RD"].includes(productType)) errors.push("productType must be FD or RD");
  if (!isUpdate && (Number.isNaN(interestRate) || interestRate <= 0 || interestRate > 30)) {
    errors.push("interestRate must be between 0 and 30");
  }
  if (!isUpdate && (Number.isNaN(tenure) || tenure <= 0)) errors.push("tenure must be positive");
  if (!isUpdate && !["days", "months", "years"].includes(tenureUnit)) {
    errors.push("tenureUnit must be days, months, or years");
  }
  if (status && !["active", "inactive"].includes(status)) {
    errors.push("status must be active or inactive");
  }
  if (!["regular", "senior-citizen"].includes(category)) {
    errors.push("customerCategory must be regular or senior-citizen");
  }

  if (body.effectiveDate || body.effective_date) {
    const d = String(body.effectiveDate || body.effective_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push("effectiveDate must be YYYY-MM-DD");
  }
  if (body.expiryDate || body.expiry_date) {
    const d = String(body.expiryDate || body.expiry_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push("expiryDate must be YYYY-MM-DD");
  }

  return {
    errors,
    data: {
      bankName,
      bankCode: sanitizeText(body.bankCode || body.bank_code || bankName.slice(0, 20), 50),
      productType,
      interestRate,
      tenure,
      tenureUnit,
      tenureLabel:
        body.tenureLabel ||
        body.tenure_label ||
        `${tenure}_${tenureUnit}`,
      minDeposit: body.minDeposit ?? body.min_deposit ?? null,
      maxDeposit: body.maxDeposit ?? body.max_deposit ?? null,
      customerCategory: category,
      seniorCitizenExtra: body.seniorCitizenExtra ?? body.senior_citizen_extra ?? null,
      effectiveDate: body.effectiveDate || body.effective_date || new Date().toISOString().slice(0, 10),
      expiryDate: body.expiryDate || body.expiry_date || null,
      status,
    },
  };
}

async function createRate(body, adminUserId, reqMeta = {}) {
  const { errors, data } = validateRateInput(body, false);
  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = errors;
    throw err;
  }

  const [result] = await pool.query(
    `INSERT INTO fd_rd_rates
      (bank_name, bank_code, product_type, interest_rate, tenure, tenure_unit, tenure_label,
       min_deposit, max_deposit, customer_category, senior_citizen_extra,
       effective_date, expiry_date, status, source)
     VALUES
      (:bankName, :bankCode, :productType, :interestRate, :tenure, :tenureUnit, :tenureLabel,
       :minDeposit, :maxDeposit, :customerCategory, :seniorCitizenExtra,
       :effectiveDate, :expiryDate, :status, 'admin')`,
    {
      bankName: data.bankName,
      bankCode: data.bankCode.toLowerCase().replace(/\s+/g, "_"),
      productType: data.productType,
      interestRate: data.interestRate,
      tenure: data.tenure,
      tenureUnit: data.tenureUnit,
      tenureLabel: data.tenureLabel,
      minDeposit: data.minDeposit,
      maxDeposit: data.maxDeposit,
      customerCategory: data.customerCategory,
      seniorCitizenExtra: data.seniorCitizenExtra,
      effectiveDate: data.effectiveDate,
      expiryDate: data.expiryDate,
      status: data.status,
    }
  );

  invalidateTickerCache();
  await writeAuditLog({
    userId: adminUserId,
    action: "RATE_CREATED",
    entityType: "fd_rd_rate",
    entityId: result.insertId,
    ipAddress: reqMeta.ip,
    meta: { bankName: data.bankName, productType: data.productType, rate: data.interestRate },
  });

  return getRateById(result.insertId);
}

async function updateRate(id, body, adminUserId, reqMeta = {}) {
  const existing = await getRateById(id);
  if (!existing) {
    const err = new Error("Rate not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const { errors, data } = validateRateInput(
    {
      bankName: body.bankName ?? body.bank_name ?? existing.bankName,
      productType: body.productType ?? body.product_type ?? existing.productType,
      interestRate: body.interestRate ?? body.interest_rate ?? existing.interestRate,
      tenure: body.tenure ?? existing.tenure,
      tenureUnit: body.tenureUnit ?? body.tenure_unit ?? existing.tenureUnit,
      ...body,
    },
    false
  );
  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = errors;
    throw err;
  }

  await pool.query(
    `UPDATE fd_rd_rates SET
      bank_name = :bankName,
      bank_code = :bankCode,
      product_type = :productType,
      interest_rate = :interestRate,
      tenure = :tenure,
      tenure_unit = :tenureUnit,
      tenure_label = :tenureLabel,
      min_deposit = :minDeposit,
      max_deposit = :maxDeposit,
      customer_category = :customerCategory,
      senior_citizen_extra = :seniorCitizenExtra,
      effective_date = :effectiveDate,
      expiry_date = :expiryDate,
      status = :status,
      source = 'admin',
      updated_at = NOW()
     WHERE id = :id`,
    {
      id,
      bankName: data.bankName || existing.bankName,
      bankCode: data.bankCode || existing.bankCode,
      productType: data.productType || existing.productType,
      interestRate: data.interestRate,
      tenure: data.tenure,
      tenureUnit: data.tenureUnit,
      tenureLabel: data.tenureLabel,
      minDeposit: data.minDeposit,
      maxDeposit: data.maxDeposit,
      customerCategory: data.customerCategory,
      seniorCitizenExtra: data.seniorCitizenExtra,
      effectiveDate: data.effectiveDate,
      expiryDate: data.expiryDate,
      status: data.status,
    }
  );

  invalidateTickerCache();
  await writeAuditLog({
    userId: adminUserId,
    action: "RATE_UPDATED",
    entityType: "fd_rd_rate",
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { rate: data.interestRate },
  });

  return getRateById(id);
}

async function updateRateStatus(id, status, adminUserId, reqMeta = {}) {
  if (!["active", "inactive"].includes(status)) {
    const err = new Error("status must be active or inactive");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const existing = await getRateById(id);
  if (!existing) {
    const err = new Error("Rate not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(`UPDATE fd_rd_rates SET status = :status, updated_at = NOW() WHERE id = :id`, {
    id,
    status,
  });

  invalidateTickerCache();
  await writeAuditLog({
    userId: adminUserId,
    action: "RATE_STATUS_CHANGED",
    entityType: "fd_rd_rate",
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { status },
  });

  return getRateById(id);
}

async function deleteRate(id, adminUserId, reqMeta = {}) {
  const existing = await getRateById(id);
  if (!existing) {
    const err = new Error("Rate not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(`UPDATE fd_rd_rates SET status = 'inactive', updated_at = NOW() WHERE id = :id`, {
    id,
  });

  invalidateTickerCache();
  await writeAuditLog({
    userId: adminUserId,
    action: "RATE_DEACTIVATED",
    entityType: "fd_rd_rate",
    entityId: id,
    ipAddress: reqMeta.ip,
  });

  return { id, status: "inactive" };
}

let syncTimer = null;

function startRateSyncScheduler() {
  const intervalMs = Number(process.env.FD_RD_SYNC_INTERVAL || 3600) * 1000;
  if (syncTimer) clearInterval(syncTimer);

  syncRatesFromProvider().catch((err) =>
    console.error("[RATES] Initial sync failed:", err.message)
  );

  syncTimer = setInterval(() => {
    syncRatesFromProvider().catch((err) =>
      console.error("[RATES] Scheduled sync failed:", err.message)
    );
  }, intervalMs);

  console.log(`[RATES] Sync scheduler started (every ${intervalMs / 1000}s)`);
}

module.exports = {
  getTicker,
  listRates,
  getRateById,
  createRate,
  updateRate,
  updateRateStatus,
  deleteRate,
  syncRatesFromProvider,
  startRateSyncScheduler,
  invalidateTickerCache,
  buildTickerPayload,
  buildHighestRates,
  isRateCurrentlyValid,
  mapRowToTickerItem,
  SYNC_SOURCES,
};
