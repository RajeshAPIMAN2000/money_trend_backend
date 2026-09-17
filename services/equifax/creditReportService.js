/**
 * Credit Report APIs (delivery_token).
 * Sandbox report IDs are fixtures — never hard-code as production defaults.
 */

const { equifaxRequest } = require("./equifaxClient");
const { getEnrollmentByUserId } = require("./enrollmentRepository");
const { writeAuditLog } = require("../../utils/audit");
const { isEquifaxMockMode } = require("./equifaxConfig");
const { mockReportPayload } = require("./equifaxMock");

async function requireEnrollmentId(userId) {
  const row = await getEnrollmentByUserId(userId);
  if (!row?.equifax_enrollment_id) {
    const err = new Error("No Equifax enrollment found. Call enrollment first.");
    err.code = "EQUIFAX_ENROLLMENT_REQUIRED";
    err.status = 400;
    throw err;
  }
  return row.equifax_enrollment_id;
}

function normalizeReportSummary(raw) {
  if (!raw || typeof raw !== "object") return { rawKeys: [] };
  return {
    creditReportId: raw.creditReportId || raw.id || raw.reportId || null,
    reportType: raw.reportType || raw.type || null,
    reportDate: raw.reportDate || raw.date || raw.asOfDate || null,
    bureau: raw.bureau || "EQUIFAX",
    // Counts if present — do not invent
    tradelineCount: raw.tradelineCount ?? raw.accounts?.length ?? null,
    inquiryCount: raw.inquiryCount ?? raw.inquiries?.length ?? null,
    collectionCount: raw.collectionCount ?? raw.collections?.length ?? null,
    keys: Object.keys(raw).slice(0, 50),
  };
}

async function getLatestCreditReport(userId, { reportType } = {}) {
  await requireEnrollmentId(userId);

  if (isEquifaxMockMode()) {
    const report = mockReportPayload(userId);
    return {
      summary: normalizeReportSummary(report),
      report,
      correlationId: "mock",
      is_mock: true,
    };
  }

  let path = "/personal/consumer-data-suite/v1/creditReport/latest";
  if (reportType) {
    path = `/personal/consumer-data-suite/v1/creditReport/latest/${encodeURIComponent(reportType)}`;
  }

  const result = await equifaxRequest({
    method: "GET",
    path,
    tokenKind: "delivery",
    operation: "creditReport.latest",
  });

  await writeAuditLog({
    userId,
    action: "EQUIFAX_CREDIT_REPORT",
    entityType: "equifax_credit_report",
    entityId: normalizeReportSummary(result.data).creditReportId,
    meta: { reportType: reportType || null },
  });

  return {
    summary: normalizeReportSummary(result.data),
    report: result.data,
    correlationId: result.correlationId,
  };
}

async function getCreditReportById(userId, creditReportId) {
  await requireEnrollmentId(userId);
  const result = await equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/creditReport/${encodeURIComponent(creditReportId)}`,
    tokenKind: "delivery",
    operation: "creditReport.byId",
  });
  return {
    summary: normalizeReportSummary(result.data),
    report: result.data,
    correlationId: result.correlationId,
  };
}

async function getCreditReportSection(userId, creditReportId, section) {
  await requireEnrollmentId(userId);
  const allowed = new Set([
    "summary",
    "collections",
    "inquiries",
    "consumerStatements",
    "personalInformation",
    "installmentAccounts",
    "mortgageAccounts",
    "revolvingAccounts",
    "otherAccounts",
    "publicRecords",
    "print",
  ]);
  if (!allowed.has(section)) {
    const err = new Error(`Unsupported credit report section: ${section}`);
    err.code = "EQUIFAX_VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  const result = await equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/creditReport/${encodeURIComponent(creditReportId)}/${section}`,
    tokenKind: "delivery",
    operation: `creditReport.${section}`,
  });

  return { section, data: result.data, correlationId: result.correlationId };
}

async function listCreditReports(userId) {
  await requireEnrollmentId(userId);
  const result = await equifaxRequest({
    method: "GET",
    path: "/personal/consumer-data-suite/v1/creditReport",
    tokenKind: "delivery",
    operation: "creditReport.list",
  });
  return { data: result.data, correlationId: result.correlationId };
}

async function requestUsEfxReport(userId, body = {}) {
  await requireEnrollmentId(userId);
  const result = await equifaxRequest({
    method: "POST",
    path: "/personal/consumer-data-suite/v1/creditReport/US_EFX",
    body,
    tokenKind: "delivery",
    operation: "creditReport.requestUsEfx",
    retryOn401: true,
  });
  return { data: result.data, correlationId: result.correlationId };
}

module.exports = {
  getLatestCreditReport,
  getCreditReportById,
  getCreditReportSection,
  listCreditReports,
  requestUsEfxReport,
  normalizeReportSummary,
};
