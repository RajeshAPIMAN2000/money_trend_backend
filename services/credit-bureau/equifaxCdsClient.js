/**
 * Equifax Consumer Data Suite HTTP client.
 * Products (scopes from Developer Dashboard):
 *  - enrollment
 *  - creditScore
 *  - creditReport
 *  - creditMonitoring
 */

const { fetchWithRetry } = require("./httpClient");
const { getEquifaxCdsUrl } = require("./equifaxConfig");
const {
  getEquifaxAuthHeaders,
  invalidateEquifaxAccessToken,
} = require("./equifaxAuth");
const {
  buildEnrollmentPayload,
  buildScoreRequest,
  buildReportRequest,
  buildMonitoringRequest,
  extractEnrollmentId,
  extractEnrollmentToken,
  extractScore,
} = require("./equifaxRequestBuilder");

async function equifaxFetch(url, { method = "POST", body, headers: extraHeaders } = {}) {
  const headers = await getEquifaxAuthHeaders(extraHeaders || {});
  return fetchWithRetry(
    url,
    {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    },
    {
      onUnauthorized: async () => {
        invalidateEquifaxAccessToken();
        const refreshed = await getEquifaxAuthHeaders(extraHeaders || {});
        return { headers: refreshed };
      },
    }
  );
}

async function enrollConsumer(input) {
  const url = getEquifaxCdsUrl("enrollment");
  const payload = buildEnrollmentPayload(input);
  const raw = await equifaxFetch(url, { method: "POST", body: payload });
  return {
    raw,
    enrollmentId: extractEnrollmentId(raw),
    enrollmentToken: extractEnrollmentToken(raw),
  };
}

async function getCreditScore({ enrollmentId, enrollmentToken, input }) {
  const url = getEquifaxCdsUrl("creditScore");
  const payload = buildScoreRequest({ enrollmentId, enrollmentToken, input });
  const raw = await equifaxFetch(url, { method: "POST", body: payload });
  return {
    raw,
    score: extractScore(raw),
  };
}

async function getCreditReport({ enrollmentId, enrollmentToken, input }) {
  const url = getEquifaxCdsUrl("creditReport");
  const payload = buildReportRequest({ enrollmentId, enrollmentToken, input });
  const raw = await equifaxFetch(url, { method: "POST", body: payload });
  return { raw };
}

async function enrollCreditMonitoring({ enrollmentId, enrollmentToken, input }) {
  const url = getEquifaxCdsUrl("creditMonitoring");
  const payload = buildMonitoringRequest({ enrollmentId, enrollmentToken, input });
  const raw = await equifaxFetch(url, { method: "POST", body: payload });
  return { raw };
}

/**
 * Full CDS pull used by credit-check:
 * 1) enroll → 2) creditScore → 3) creditReport (optional) → 4) monitoring (optional)
 */
async function pullConsumerCreditBundle(input = {}) {
  const includeReport =
    String(process.env.EQUIFAX_CDS_FETCH_REPORT || "true").toLowerCase() !== "false";
  const includeMonitoring =
    String(process.env.EQUIFAX_CDS_ENABLE_MONITORING || "false").toLowerCase() === "true";

  const enrollment = await enrollConsumer(input);
  if (!enrollment.enrollmentId && !enrollment.enrollmentToken) {
    const err = new Error(
      "Equifax enrollment succeeded but no enrollmentId/token was returned. Check your Equifax API Reference mapper."
    );
    err.code = "EQUIFAX_ENROLLMENT_ID_MISSING";
    err.raw = enrollment.raw;
    throw err;
  }

  const scoreResult = await getCreditScore({
    enrollmentId: enrollment.enrollmentId,
    enrollmentToken: enrollment.enrollmentToken,
    input,
  });

  let reportResult = null;
  if (includeReport) {
    try {
      reportResult = await getCreditReport({
        enrollmentId: enrollment.enrollmentId,
        enrollmentToken: enrollment.enrollmentToken,
        input,
      });
    } catch (error) {
      console.error("[EQUIFAX] creditReport call failed (score still used):", error.code || error.message);
    }
  }

  let monitoringResult = null;
  if (includeMonitoring) {
    try {
      monitoringResult = await enrollCreditMonitoring({
        enrollmentId: enrollment.enrollmentId,
        enrollmentToken: enrollment.enrollmentToken,
        input: { ...input, enableMonitoring: true },
      });
    } catch (error) {
      console.error("[EQUIFAX] creditMonitoring call failed:", error.code || error.message);
    }
  }

  return {
    enrollmentId: enrollment.enrollmentId,
    enrollmentTokenPresent: Boolean(enrollment.enrollmentToken),
    score: scoreResult.score,
    enrollmentRaw: enrollment.raw,
    scoreRaw: scoreResult.raw,
    reportRaw: reportResult?.raw || null,
    monitoringRaw: monitoringResult?.raw || null,
  };
}

module.exports = {
  enrollConsumer,
  getCreditScore,
  getCreditReport,
  enrollCreditMonitoring,
  pullConsumerCreditBundle,
  equifaxFetch,
};
