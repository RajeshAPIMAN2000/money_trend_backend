const pool = require("../config/db");
const { getProvider, BUREAUS } = require("./credit-bureau");
const { encryptPii, decryptPii, maskPan } = require("../utils/security");
const { writeAuditLog } = require("../utils/audit");

const RATE_LIMIT_HOURS = 24;

async function loadKycForCreditCheck(userId) {
  const [users] = await pool.query(
    `SELECT id, full_name, phone, kyc_status, date_of_birth FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );
  if (!users.length) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  if (users[0].kyc_status !== "verified") {
    const err = new Error("KYC must be verified before running a credit check");
    err.code = "KYC_NOT_VERIFIED";
    throw err;
  }

  const [kycRows] = await pool.query(
    `SELECT pan_number, pan_full_name, aadhaar_number, status
     FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
    { userId }
  );
  if (!kycRows.length || kycRows[0].status !== "verified") {
    const err = new Error("Approved KYC record with verified PAN and Aadhaar is required");
    err.code = "KYC_NOT_VERIFIED";
    throw err;
  }

  const kyc = kycRows[0];
  const aadhaarDigits = String(kyc.aadhaar_number || "").replace(/\D/g, "");
  const dobRaw = users[0].date_of_birth;
  const dob =
    dobRaw instanceof Date
      ? dobRaw.toISOString().slice(0, 10)
      : dobRaw
        ? String(dobRaw).slice(0, 10)
        : null;

  return {
    userId,
    fullName: kyc.pan_full_name || users[0].full_name,
    pan: String(kyc.pan_number || "").toUpperCase(),
    mobile: users[0].phone,
    dob,
    aadhaarLast4: aadhaarDigits.slice(-4) || null,
    address: null,
  };
}

async function hasRecentCheck(userId, bureau) {
  if (!userId) return false;
  const [rows] = await pool.query(
    `SELECT id FROM credit_checks
     WHERE user_id = :userId AND bureau = :bureau
       AND created_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
     LIMIT 1`,
    { userId, bureau, hours: RATE_LIMIT_HOURS }
  );
  return rows.length > 0;
}

async function hasRecentCheckByPhone(phone, bureau) {
  const mobile = String(phone || "").replace(/\s+/g, "").trim();
  if (!mobile) return false;
  const [rows] = await pool.query(
    `SELECT id FROM credit_checks
     WHERE guest_phone = :mobile AND bureau = :bureau
       AND created_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
     LIMIT 1`,
    { mobile, bureau, hours: RATE_LIMIT_HOURS }
  );
  return rows.length > 0;
}

async function insertPendingCheck({
  userId,
  guestPhone,
  bureau,
  pan,
  requestedBy,
  consentGiven,
  consentTimestamp,
  consentIp,
  consentVersion,
}) {
  const [result] = await pool.query(
    `INSERT INTO credit_checks
      (user_id, guest_phone, bureau, pan_number, status, requested_by,
       consent_given, consent_timestamp, consent_ip, consent_version)
     VALUES
      (:userId, :guestPhone, :bureau, :pan, 'PENDING', :requestedBy,
       :consentGiven, :consentTimestamp, :consentIp, :consentVersion)`,
    {
      userId: userId || null,
      guestPhone: guestPhone || null,
      bureau,
      pan: encryptPii(pan),
      requestedBy,
      consentGiven: consentGiven ? 1 : 0,
      consentTimestamp,
      consentIp,
      consentVersion,
    }
  );
  return result.insertId;
}

async function saveCheckResult(checkId, report, errorMessage = null) {
  const status = report?.status || (errorMessage ? "FAILED" : "FAILED");
  const normalizedForDb = report
    ? {
        bureau: report.bureau,
        score: report.score,
        scoreRange: report.scoreRange,
        reportDate: report.reportDate,
        reportRefId: report.reportRefId,
        status: report.status,
        accounts: report.accounts,
        enquiries: report.enquiries,
      }
    : null;

  const rawEncrypted = report?.rawResponse
    ? encryptPii(JSON.stringify(report.rawResponse))
    : null;

  await pool.query(
    `UPDATE credit_checks SET
      score = :score,
      score_min = :scoreMin,
      score_max = :scoreMax,
      status = :status,
      report_ref_id = :reportRefId,
      report_date = :reportDate,
      normalized_report = :normalizedReport,
      raw_response = :rawResponse,
      error_message = :errorMessage
     WHERE id = :checkId`,
    {
      checkId,
      score: report?.score ?? null,
      scoreMin: report?.scoreRange?.min ?? null,
      scoreMax: report?.scoreRange?.max ?? null,
      status,
      reportRefId: report?.reportRefId ?? null,
      reportDate: report?.reportDate ?? null,
      normalizedReport: normalizedForDb ? JSON.stringify(normalizedForDb) : null,
      rawResponse: rawEncrypted,
      errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
    }
  );

  if (report && (report.accounts?.length || report.enquiries?.length)) {
    for (const account of report.accounts || []) {
      await pool.query(
        `INSERT INTO credit_check_accounts
          (credit_check_id, account_type, lender, status, credit_limit,
           current_balance, overdue_amount, payment_history)
         VALUES
          (:checkId, :accountType, :lender, :status, :creditLimit,
           :currentBalance, :overdueAmount, :paymentHistory)`,
        {
          checkId,
          accountType: account.accountType,
          lender: account.lender,
          status: account.status,
          creditLimit: account.creditLimit,
          currentBalance: account.currentBalance,
          overdueAmount: account.overdueAmount,
          paymentHistory: account.paymentHistory,
        }
      );
    }
    for (const enquiry of report.enquiries || []) {
      await pool.query(
        `INSERT INTO credit_check_enquiries
          (credit_check_id, enquiry_date, lender, purpose)
         VALUES (:checkId, :enquiryDate, :lender, :purpose)`,
        {
          checkId,
          enquiryDate: enquiry.date,
          lender: enquiry.lender,
          purpose: enquiry.purpose,
        }
      );
    }
  }
}

async function fetchWithServiceRetry(provider, input, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await provider.fetchCreditReport(input);
    } catch (error) {
      lastError = error;
      const isTimeout =
        error.name === "AbortError" || /timeout|ETIMEDOUT|aborted/i.test(error.message);
      if (attempt < maxAttempts && isTimeout) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

async function runCreditCheck({
  userId,
  bureau,
  requestedBy = "USER",
  consentGiven,
  consentTimestamp,
  consentIp,
  consentVersion,
  reqMeta = {},
  applicantInput = null,
}) {
  const kycInput = applicantInput || (await loadKycForCreditCheck(userId));
  const provider = getProvider(bureau);
  const bureauKey = provider.name;

  const checkId = await insertPendingCheck({
    userId: userId || null,
    guestPhone: kycInput.mobile || null,
    bureau: bureauKey,
    pan: kycInput.pan,
    requestedBy,
    consentGiven,
    consentTimestamp,
    consentIp,
    consentVersion,
  });

  console.log(
    `[CREDIT-CHECK] Started check #${checkId} bureau=${bureauKey} user=${userId || "guest"} pan=${maskPan(kycInput.pan)}`
  );

  try {
    const report = await fetchWithServiceRetry(provider, {
      ...kycInput,
      consentRef: `check-${checkId}`,
    });

    await saveCheckResult(checkId, report);

    await writeAuditLog({
      userId: userId || null,
      action: "CREDIT_CHECK_COMPLETED",
      entityType: "credit_check",
      entityId: checkId,
      ipAddress: consentIp,
      meta: {
        bureau: bureauKey,
        status: report.status,
        score: report.score,
        reportRefId: report.reportRefId,
        guest: !userId,
      },
    });

    return formatCheckDetail(await getCheckById(checkId));
  } catch (error) {
    await saveCheckResult(checkId, null, error.message);
    await writeAuditLog({
      userId: userId || null,
      action: "CREDIT_CHECK_FAILED",
      entityType: "credit_check",
      entityId: checkId,
      ipAddress: consentIp,
      meta: { bureau: bureauKey, error: error.message, guest: !userId },
    });
    throw error;
  }
}

/**
 * Public / no-login CIBIL pull using details entered on the form.
 * Links to an existing user by phone when found; otherwise stores as guest.
 */
async function runPublicCreditCheck({
  bureau = "CIBIL",
  fullName,
  pan,
  mobile,
  dob,
  address = null,
  consentGiven,
  consentTimestamp,
  consentIp,
  consentVersion,
}) {
  const { normalizePan, isValidPan, isValidPhone, parseDob, sanitizeText } = require("../utils/validators");

  const cleanPan = normalizePan(pan);
  const cleanMobile = String(mobile || "").replace(/\s+/g, "").trim();
  const cleanName = sanitizeText(fullName, 150);
  const dobParsed = parseDob(dob);

  const errors = [];
  if (!cleanName) errors.push("fullName is required");
  if (!isValidPan(cleanPan)) errors.push("valid PAN is required");
  if (!isValidPhone(cleanMobile)) errors.push("valid 10-digit mobile is required");
  if (!dobParsed) errors.push("valid dateOfBirth is required (YYYY-MM-DD)");
  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = errors;
    throw err;
  }

  const [users] = await pool.query(
    `SELECT id FROM users WHERE phone = :phone LIMIT 1`,
    { phone: cleanMobile }
  );
  const userId = users[0]?.id || null;

  if (userId) {
    const recent = await hasRecentCheck(userId, bureau);
    if (recent) {
      const err = new Error(
        `Credit check for ${bureau} already performed within the last ${RATE_LIMIT_HOURS} hours`
      );
      err.status = 429;
      err.code = "BUREAU_RATE_LIMITED";
      throw err;
    }
  } else {
    const recent = await hasRecentCheckByPhone(cleanMobile, bureau);
    if (recent) {
      const err = new Error(
        `Credit check for ${bureau} already performed within the last ${RATE_LIMIT_HOURS} hours`
      );
      err.status = 429;
      err.code = "BUREAU_RATE_LIMITED";
      throw err;
    }
  }

  return runCreditCheck({
    userId,
    bureau,
    requestedBy: "USER",
    consentGiven,
    consentTimestamp,
    consentIp,
    consentVersion,
    applicantInput: {
      userId,
      fullName: cleanName,
      pan: cleanPan,
      mobile: cleanMobile,
      dob: dobParsed.iso,
      aadhaarLast4: null,
      address: address || null,
    },
  });
}

async function getCheckById(checkId) {
  const [rows] = await pool.query(
    `SELECT * FROM credit_checks WHERE id = :checkId LIMIT 1`,
    { checkId }
  );
  if (!rows.length) return null;

  const check = rows[0];
  const [accounts] = await pool.query(
    `SELECT account_type, lender, status, credit_limit, current_balance,
            overdue_amount, payment_history
     FROM credit_check_accounts WHERE credit_check_id = :checkId`,
    { checkId }
  );
  const [enquiries] = await pool.query(
    `SELECT enquiry_date, lender, purpose
     FROM credit_check_enquiries WHERE credit_check_id = :checkId`,
    { checkId }
  );

  return { ...check, accounts, enquiries };
}

function deriveScoreBand(bureau, score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const s = Number(score);
  // Generic Experian India retail score band labels (UX only — not a CIBIL score).
  if (String(bureau).toUpperCase() === "EXPERIAN") {
    if (s >= 800) return "EXCELLENT";
    if (s >= 740) return "VERY_GOOD";
    if (s >= 670) return "GOOD";
    if (s >= 580) return "FAIR";
    return "POOR";
  }
  if (s >= 750) return "GOOD";
  if (s >= 650) return "FAIR";
  return "POOR";
}

function scoreLabel(bureau) {
  if (String(bureau).toUpperCase() === "EXPERIAN") return "Experian Credit Score";
  if (String(bureau).toUpperCase() === "CIBIL") return "CIBIL Score";
  return `${String(bureau).toUpperCase()} Credit Score`;
}

function formatCheckSummary(row) {
  let normalized = null;
  if (row.normalized_report) {
    try {
      normalized =
        typeof row.normalized_report === "string"
          ? JSON.parse(row.normalized_report)
          : row.normalized_report;
    } catch (_e) {
      normalized = null;
    }
  }

  const score = row.score;
  return {
    id: row.id,
    user_id: row.user_id,
    guest_phone: row.guest_phone || null,
    provider: row.bureau,
    bureau: row.bureau,
    score_label: scoreLabel(row.bureau),
    score,
    score_band: deriveScoreBand(row.bureau, score),
    score_range:
      row.score_min != null && row.score_max != null
        ? { min: row.score_min, max: row.score_max }
        : normalized?.scoreRange || null,
    status: row.status,
    report_ref_id: row.report_ref_id,
    report_date: row.report_date,
    reportAvailable: Boolean(row.report_ref_id) && row.status === "SUCCESS",
    requested_by: row.requested_by,
    consent_given: Boolean(row.consent_given),
    consent_timestamp: row.consent_timestamp,
    consent_version: row.consent_version,
    error_message: row.error_message,
    created_at: row.created_at,
    // Safe summary only — never include raw_response
    result_summary: normalized
      ? {
          bureau: normalized.bureau,
          score: normalized.score,
          status: normalized.status,
          reportRefId: normalized.reportRefId,
          accountCount: Array.isArray(normalized.accounts) ? normalized.accounts.length : 0,
          enquiryCount: Array.isArray(normalized.enquiries) ? normalized.enquiries.length : 0,
        }
      : null,
  };
}

function formatCheckDetail(row) {
  if (!row) return null;

  const summary = formatCheckSummary(row);
  let normalized = null;
  if (row.normalized_report) {
    try {
      normalized =
        typeof row.normalized_report === "string"
          ? JSON.parse(row.normalized_report)
          : row.normalized_report;
    } catch (_e) {
      normalized = null;
    }
  }

  summary.accounts = (row.accounts || []).map((a) => ({
    account_type: a.account_type,
    lender: a.lender,
    status: a.status,
    credit_limit: a.credit_limit,
    current_balance: a.current_balance,
    overdue_amount: a.overdue_amount,
    payment_history: a.payment_history,
  }));
  summary.enquiries = (row.enquiries || []).map((e) => ({
    date: e.enquiry_date,
    lender: e.lender,
    purpose: e.purpose,
  }));
  summary.pan_number = maskPan(decryptPii(row.pan_number) || row.pan_number);
  // Keep normalized accounts/enquiries summary for clients that expect it — never rawResponse.
  if (normalized) {
    summary.normalized_report = {
      bureau: normalized.bureau,
      score: normalized.score,
      scoreRange: normalized.scoreRange,
      reportDate: normalized.reportDate,
      reportRefId: normalized.reportRefId,
      status: normalized.status,
    };
  }
  return summary;
}

async function listAdminCreditChecks({ bureau, status, userId, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = {};
  if (bureau) {
    conditions.push("bureau = :bureau");
    params.bureau = String(bureau).toUpperCase();
  }
  if (status) {
    conditions.push("status = :status");
    params.status = String(status).toUpperCase();
  }
  if (userId) {
    conditions.push("user_id = :userId");
    params.userId = Number(userId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT id, user_id, bureau, score, score_min, score_max, status,
            report_ref_id, report_date, normalized_report, requested_by,
            consent_given, consent_timestamp, consent_version, error_message, created_at
     FROM credit_checks
     ${where}
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM credit_checks ${where}`,
    params
  );

  return {
    items: rows.map(formatCheckSummary),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getHistory(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, guest_phone, bureau, score, score_min, score_max, status,
            report_ref_id, report_date, normalized_report, requested_by,
            consent_given, consent_timestamp, consent_version, error_message, created_at
     FROM credit_checks
     WHERE user_id = :userId
     ORDER BY created_at DESC`,
    { userId }
  );
  return rows.map(formatCheckSummary);
}

async function getHistoryByPhone(phone) {
  const mobile = String(phone || "").replace(/\s+/g, "").trim();
  const [rows] = await pool.query(
    `SELECT id, user_id, guest_phone, bureau, score, score_min, score_max, status,
            report_ref_id, report_date, normalized_report, requested_by,
            consent_given, consent_timestamp, consent_version, error_message, created_at
     FROM credit_checks
     WHERE guest_phone = :mobile OR user_id IN (SELECT id FROM users WHERE phone = :mobile)
     ORDER BY created_at DESC`,
    { mobile }
  );
  return rows.map(formatCheckSummary);
}

/**
 * Latest successful (or most recent) score per bureau for a user — for UI score cards.
 */
async function getLatestScores(userId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.guest_phone, c.bureau, c.score, c.score_min, c.score_max, c.status,
            c.report_ref_id, c.report_date, c.normalized_report, c.requested_by,
            c.consent_given, c.consent_timestamp, c.consent_version, c.error_message, c.created_at
     FROM credit_checks c
     INNER JOIN (
       SELECT bureau, MAX(id) AS max_id
       FROM credit_checks
       WHERE user_id = :userId
       GROUP BY bureau
     ) latest ON latest.max_id = c.id
     ORDER BY c.bureau ASC`,
    { userId }
  );

  const byBureau = {};
  for (const row of rows) {
    byBureau[row.bureau] = formatCheckSummary(row);
  }

  const cibil = byBureau.CIBIL || null;
  const experian = byBureau.EXPERIAN || null;
  const primary = cibil || experian || (rows[0] ? formatCheckSummary(rows[0]) : null);

  return {
    user_id: Number(userId),
    /** Prefer CIBIL for the main "CIBIL score" card when available */
    primary_score: primary
      ? {
          bureau: primary.bureau,
          score_label: primary.score_label,
          score: primary.score,
          score_band: primary.score_band,
          status: primary.status,
          report_ref_id: primary.report_ref_id,
          report_date: primary.report_date,
          checked_at: primary.created_at,
        }
      : null,
    cibil_score: cibil
      ? {
          score: cibil.score,
          score_band: cibil.score_band,
          score_label: cibil.score_label,
          status: cibil.status,
          checked_at: cibil.created_at,
          report_ref_id: cibil.report_ref_id,
        }
      : null,
    scores_by_bureau: byBureau,
    latest_checks: rows.map(formatCheckSummary),
  };
}

async function getLatestScoresByPhone(phone) {
  const mobile = String(phone || "").replace(/\s+/g, "").trim();
  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.guest_phone, c.bureau, c.score, c.score_min, c.score_max, c.status,
            c.report_ref_id, c.report_date, c.normalized_report, c.requested_by,
            c.consent_given, c.consent_timestamp, c.consent_version, c.error_message, c.created_at
     FROM credit_checks c
     INNER JOIN (
       SELECT bureau, MAX(id) AS max_id
       FROM credit_checks
       WHERE guest_phone = :mobile
          OR user_id IN (SELECT id FROM users WHERE phone = :mobile)
       GROUP BY bureau
     ) latest ON latest.max_id = c.id
     ORDER BY c.bureau ASC`,
    { mobile }
  );

  const byBureau = {};
  for (const row of rows) {
    byBureau[row.bureau] = formatCheckSummary(row);
  }
  const cibil = byBureau.CIBIL || null;
  const experian = byBureau.EXPERIAN || null;
  const primary = cibil || experian || (rows[0] ? formatCheckSummary(rows[0]) : null);

  return {
    guest_phone: mobile,
    user_id: rows[0]?.user_id || null,
    primary_score: primary
      ? {
          bureau: primary.bureau,
          score_label: primary.score_label,
          score: primary.score,
          score_band: primary.score_band,
          status: primary.status,
          report_ref_id: primary.report_ref_id,
          report_date: primary.report_date,
          checked_at: primary.created_at,
        }
      : null,
    cibil_score: cibil
      ? {
          score: cibil.score,
          score_band: cibil.score_band,
          score_label: cibil.score_label,
          status: cibil.status,
          checked_at: cibil.created_at,
          report_ref_id: cibil.report_ref_id,
        }
      : null,
    scores_by_bureau: byBureau,
    latest_checks: rows.map(formatCheckSummary),
  };
}

/**
 * Batch latest CIBIL/Experian scores for many users (admin list).
 */
async function getLatestScoresMapForUsers(userIds = []) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return {};

  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.bureau, c.score, c.score_min, c.score_max, c.status,
            c.report_ref_id, c.report_date, c.normalized_report, c.requested_by,
            c.consent_given, c.consent_timestamp, c.consent_version, c.error_message, c.created_at
     FROM credit_checks c
     INNER JOIN (
       SELECT user_id, bureau, MAX(id) AS max_id
       FROM credit_checks
       WHERE user_id IN (${ids.map(() => "?").join(",")})
       GROUP BY user_id, bureau
     ) latest ON latest.max_id = c.id`,
    ids
  );

  const map = {};
  for (const id of ids) {
    map[id] = {
      cibil_score: null,
      experian_score: null,
      primary_score: null,
    };
  }

  for (const row of rows) {
    const summary = formatCheckSummary(row);
    const entry = map[row.user_id] || {
      cibil_score: null,
      experian_score: null,
      primary_score: null,
    };
    const compact = {
      bureau: summary.bureau,
      score: summary.score,
      score_band: summary.score_band,
      score_label: summary.score_label,
      status: summary.status,
      checked_at: summary.created_at,
      report_ref_id: summary.report_ref_id,
    };
    if (row.bureau === "CIBIL") entry.cibil_score = compact;
    if (row.bureau === "EXPERIAN") entry.experian_score = compact;
    if (!entry.primary_score || row.bureau === "CIBIL") {
      entry.primary_score = compact;
    }
    map[row.user_id] = entry;
  }

  return map;
}

async function listAdminCreditChecksWithUsers({
  bureau,
  status,
  userId,
  limit = 50,
  offset = 0,
} = {}) {
  const conditions = [];
  const params = {};
  if (bureau) {
    conditions.push("c.bureau = :bureau");
    params.bureau = String(bureau).toUpperCase();
  }
  if (status) {
    conditions.push("c.status = :status");
    params.status = String(status).toUpperCase();
  }
  if (userId) {
    conditions.push("c.user_id = :userId");
    params.userId = Number(userId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.guest_phone, c.bureau, c.score, c.score_min, c.score_max, c.status,
            c.report_ref_id, c.report_date, c.normalized_report, c.requested_by,
            c.consent_given, c.consent_timestamp, c.consent_version, c.error_message, c.created_at,
            u.full_name, u.email, u.phone, u.kyc_status
     FROM credit_checks c
     LEFT JOIN users u ON u.id = c.user_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM credit_checks c
     LEFT JOIN users u ON u.id = c.user_id
     ${where}`,
    params
  );

  return {
    items: rows.map((row) => ({
      ...formatCheckSummary(row),
      user: row.user_id
        ? {
            id: row.user_id,
            full_name: row.full_name,
            email: row.email,
            phone: row.phone || row.guest_phone,
            kyc_status: row.kyc_status,
          }
        : {
            id: null,
            full_name: null,
            email: null,
            phone: row.guest_phone,
            kyc_status: null,
            is_guest: true,
          },
    })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function runAllBureaus({
  userId,
  requestedBy = "ADMIN",
  consentGiven,
  consentTimestamp,
  consentIp,
  consentVersion,
}) {
  const results = [];
  const errors = [];

  await Promise.all(
    BUREAUS.map(async (bureau) => {
      try {
        const recent = await hasRecentCheck(userId, bureau);
        if (recent) {
          errors.push({ bureau, error: "Rate limit: bureau already checked in last 24 hours" });
          return;
        }
        const result = await runCreditCheck({
          userId,
          bureau,
          requestedBy,
          consentGiven,
          consentTimestamp,
          consentIp,
          consentVersion,
        });
        results.push(result);
      } catch (error) {
        errors.push({ bureau, error: error.message });
      }
    })
  );

  return { results, errors };
}

module.exports = {
  RATE_LIMIT_HOURS,
  loadKycForCreditCheck,
  hasRecentCheck,
  hasRecentCheckByPhone,
  runCreditCheck,
  runPublicCreditCheck,
  runAllBureaus,
  getHistory,
  getHistoryByPhone,
  getCheckById,
  formatCheckDetail,
  formatCheckSummary,
  listAdminCreditChecks,
  listAdminCreditChecksWithUsers,
  getLatestScores,
  getLatestScoresByPhone,
  getLatestScoresMapForUsers,
  deriveScoreBand,
};
