const { normalize } = require("./normalizer");
const { mockEquifax, mockNoHit } = require("./mockResponses");
const { isEquifaxLiveMode, resolveEquifaxEnv, getEquifaxBaseUrl } = require("./equifaxConfig");
const { pullConsumerCreditBundle } = require("./equifaxCdsClient");

const name = "EQUIFAX";

function mapCdsBundleToRaw(bundle, input) {
  const report = bundle.reportRaw || {};
  const scoreRaw = bundle.scoreRaw || {};

  const tradeLines =
    report.tradeLines ||
    report.accounts ||
    report.tradelines ||
    report.data?.tradeLines ||
    scoreRaw.tradeLines ||
    [];

  const inquiries =
    report.inquiryHistory ||
    report.enquiries ||
    report.inquiries ||
    report.data?.inquiries ||
    [];

  const score =
    bundle.score ??
    scoreRaw.score ??
    scoreRaw.creditScore ??
    scoreRaw.scoreValue ??
    null;

  if (score == null && String(process.env.EQUIFAX_TREAT_NULL_SCORE_AS_NO_HIT || "true") === "true") {
    return {
      status: "NO_HIT",
      reportDate: new Date().toISOString().slice(0, 10),
      reportRefId: bundle.enrollmentId || `EQF-NOHIT-${Date.now()}`,
      equifaxCds: true,
      enrollmentId: bundle.enrollmentId,
    };
  }

  return {
    equifaxReportId:
      report.reportId ||
      report.equifaxReportId ||
      scoreRaw.reportId ||
      bundle.enrollmentId ||
      `EQF-${Date.now()}`,
    generatedOn: new Date().toISOString().slice(0, 10),
    scoreValue: score,
    scoreRange: { minimum: 300, maximum: 900 },
    tradeLines: Array.isArray(tradeLines) ? tradeLines : [],
    inquiryHistory: Array.isArray(inquiries) ? inquiries : [],
    consumer: { pan: input.pan, enrollmentId: bundle.enrollmentId },
    equifaxCds: true,
    enrollmentId: bundle.enrollmentId,
    scoreCoach: scoreRaw.scoreCoach || scoreRaw.coach || null,
    _cdsMeta: {
      env: resolveEquifaxEnv(),
      baseUrl: getEquifaxBaseUrl(),
      monitoringEnrolled: Boolean(bundle.monitoringRaw),
      reportFetched: Boolean(bundle.reportRaw),
    },
  };
}

async function fetchCreditReport(input) {
  const mode = String(process.env.CREDIT_CHECK_MODE || "sandbox").toLowerCase();

  // Local mock unless explicitly in uat/test/live
  if (!isEquifaxLiveMode() || mode === "sandbox") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("EQUIFAX") : mockEquifax(input);
    return normalize(name, raw);
  }

  console.log("[EQUIFAX] CDS pull starting", {
    env: resolveEquifaxEnv(),
    baseUrl: getEquifaxBaseUrl(),
    pan_masked: input.pan ? `${String(input.pan).slice(0, 2)}****${String(input.pan).slice(-1)}` : null,
  });

  const bundle = await pullConsumerCreditBundle(input);
  const raw = mapCdsBundleToRaw(bundle, input);
  return normalize(name, raw);
}

async function enrollOnly(input) {
  const { enrollConsumer } = require("./equifaxCdsClient");
  return enrollConsumer(input);
}

async function getScoreOnly(input) {
  const { getCreditScore } = require("./equifaxCdsClient");
  return getCreditScore(input);
}

module.exports = {
  name,
  fetchCreditReport,
  enrollOnly,
  getScoreOnly,
  mapCdsBundleToRaw,
};
