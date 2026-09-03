const pool = require("../config/db");
const { getProvider, BUREAUS } = require("./credit-bureau");
const { encryptPii, decryptPii, maskPan } = require("../utils/security");
const { writeAuditLog } = require("../utils/audit");

const RATE_LIMIT_HOURS = 24;

async function loadKycForCreditCheck(userId) {
  const [users] = await pool.query(
    `SELECT id, full_name, phone, kyc_status FROM users WHERE id = :userId LIMIT 1`,
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

  return {
    userId,
    fullName: kyc.pan_full_name || users[0].full_name,
    pan: String(kyc.pan_number || "").toUpperCase(),
    mobile: users[0].phone,
    dob: null,
    aadhaarLast4: aadhaarDigits.slice(-4) || null,
    address: null,
  };
}

async function hasRecentCheck(userId, bureau) {
  const [rows] = await pool.query(
    `SELECT id FROM credit_checks
     WHERE user_id = :userId AND bureau = :bureau
       AND created_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
     LIMIT 1`,
    { userId, bureau, hours: RATE_LIMIT_HOURS }
  );
  return rows.length > 0;
}

async function insertPendingCheck({
  userId,
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
      (user_id, bureau, pan_number, status, requested_by,
       consent_given, consent_timestamp, consent_ip, consent_version)
     VALUES
      (:userId, :bureau, :pan, 'PENDING', :requestedBy,
       :consentGiven, :consentTimestamp, :consentIp, :consentVersion)`,
    {
      userId,
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
}) {
  const kycInput = await loadKycForCreditCheck(userId);
  const provider = getProvider(bureau);
  const bureauKey = provider.name;

  const checkId = await insertPendingCheck({
    userId,
    bureau: bureauKey,
    pan: kycInput.pan,
    requestedBy,
    consentGiven,
    consentTimestamp,
    consentIp,
    consentVersion,
  });

  console.log(
    `[CREDIT-CHECK] Started check #${checkId} bureau=${bureauKey} user=${userId} pan=${maskPan(kycInput.pan)}`
  );

  try {
    const report = await fetchWithServiceRetry(provider, {
      ...kycInput,
      consentRef: `check-${checkId}`,
    });

    await saveCheckResult(checkId, report);

    await writeAuditLog({
      userId,
      action: "CREDIT_CHECK_COMPLETED",
      entityType: "credit_check",
      entityId: checkId,
      ipAddress: consentIp,
      meta: {
        bureau: bureauKey,
        status: report.status,
        score: report.score,
        reportRefId: report.reportRefId,
      },
    });

    return formatCheckDetail(await getCheckById(checkId));
  } catch (error) {
    await saveCheckResult(checkId, null, error.message);
    await writeAuditLog({
      userId,
      action: "CREDIT_CHECK_FAILED",
      entityType: "credit_check",
      entityId: checkId,
      ipAddress: consentIp,
      meta: { bureau: bureauKey, error: error.message },
    });
    throw error;
  }
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

  return {
    id: row.id,
    user_id: row.user_id,
    bureau: row.bureau,
    score: row.score,
    score_range:
      row.score_min != null && row.score_max != null
        ? { min: row.score_min, max: row.score_max }
        : normalized?.scoreRange || null,
    status: row.status,
    report_ref_id: row.report_ref_id,
    report_date: row.report_date,
    requested_by: row.requested_by,
    consent_given: Boolean(row.consent_given),
    consent_timestamp: row.consent_timestamp,
    consent_version: row.consent_version,
    error_message: row.error_message,
    created_at: row.created_at,
    normalized_report: normalized,
  };
}

function formatCheckDetail(row) {
  if (!row) return null;

  const summary = formatCheckSummary(row);
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
  return summary;
}

async function getHistory(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, bureau, score, score_min, score_max, status,
            report_ref_id, report_date, normalized_report, requested_by,
            consent_given, consent_timestamp, consent_version, error_message, created_at
     FROM credit_checks
     WHERE user_id = :userId
     ORDER BY created_at DESC`,
    { userId }
  );
  return rows.map(formatCheckSummary);
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
  runCreditCheck,
  runAllBureaus,
  getHistory,
  getCheckById,
  formatCheckDetail,
};
