/**
 * Equifax Consumer Data Suite request builders.
 * Official field schemas are in the Equifax API Reference (login required).
 * Override via EQUIFAX_CDS_MAPPER_MODULE or enable EQUIFAX_CDS_ALLOW_DEV_TEMPLATE for connectivity tests.
 */

const path = require("path");
const { getEquifaxMemberNumber } = require("./equifaxConfig");

function splitName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "UNKNOWN", lastName: "UNKNOWN" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function loadMapperModule() {
  const mod = String(process.env.EQUIFAX_CDS_MAPPER_MODULE || "").trim();
  if (!mod) return null;
  const resolved = path.isAbsolute(mod) ? mod : path.join(process.cwd(), mod);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mapper = require(resolved);
  if (typeof mapper === "function") return mapper;
  if (mapper && typeof mapper.buildEnrollmentPayload === "function") return mapper;
  const err = new Error("EQUIFAX_CDS_MAPPER_MODULE must export a function or { buildEnrollmentPayload }");
  err.code = "EQUIFAX_MAPPER_INVALID";
  throw err;
}

function buildDevEnrollmentTemplate(input) {
  const { firstName, lastName } = splitName(input.fullName);
  return {
    memberNumber: getEquifaxMemberNumber(),
    consumer: {
      name: {
        firstName,
        lastName,
        middleName: input.middleName || undefined,
      },
      dateOfBirth: input.dob || input.dateOfBirth,
      emailAddress: input.email || undefined,
      homePhone: input.mobile || input.phone || undefined,
      nationalId: input.pan || input.nationalId || undefined,
      currentAddress: input.address
        ? {
            line1: typeof input.address === "string" ? input.address : input.address.line1,
            city: input.address.city || input.city || undefined,
            state: input.address.state || input.state || undefined,
            postalCode: input.address.postalCode || input.pincode || undefined,
            countryCode: input.countryCode || "IN",
          }
        : undefined,
    },
    consent: {
      given: true,
      version: input.consentVersion || input.consentRef || "v1",
      timestamp: new Date().toISOString(),
    },
    productCodes: {
      creditScore: true,
      creditReport: true,
      creditMonitoring: Boolean(input.enableMonitoring),
    },
  };
}

function buildEnrollmentPayload(input) {
  const mapper = loadMapperModule();
  if (typeof mapper === "function") return mapper(input);
  if (mapper && typeof mapper.buildEnrollmentPayload === "function") {
    return mapper.buildEnrollmentPayload(input);
  }

  const allowDev = String(process.env.EQUIFAX_CDS_ALLOW_DEV_TEMPLATE || "false").toLowerCase() === "true";
  if (!allowDev) {
    const err = new Error(
      "Equifax CDS enrollment body is not configured. Set EQUIFAX_CDS_MAPPER_MODULE to your official mapper from Equifax API docs, or set EQUIFAX_CDS_ALLOW_DEV_TEMPLATE=true for connectivity tests only."
    );
    err.code = "EQUIFAX_PAYLOAD_NOT_CONFIGURED";
    throw err;
  }

  return buildDevEnrollmentTemplate(input);
}

function buildScoreRequest({ enrollmentId, enrollmentToken, input }) {
  const mapper = loadMapperModule();
  if (mapper && typeof mapper.buildCreditScorePayload === "function") {
    return mapper.buildCreditScorePayload({ enrollmentId, enrollmentToken, input });
  }
  return {
    enrollmentId: enrollmentId || undefined,
    enrollmentToken: enrollmentToken || undefined,
    memberNumber: getEquifaxMemberNumber() || undefined,
    scoreModel: process.env.EQUIFAX_SCORE_MODEL || undefined,
  };
}

function buildReportRequest({ enrollmentId, enrollmentToken, input }) {
  const mapper = loadMapperModule();
  if (mapper && typeof mapper.buildCreditReportPayload === "function") {
    return mapper.buildCreditReportPayload({ enrollmentId, enrollmentToken, input });
  }
  return {
    enrollmentId: enrollmentId || undefined,
    enrollmentToken: enrollmentToken || undefined,
    memberNumber: getEquifaxMemberNumber() || undefined,
    reportType: process.env.EQUIFAX_REPORT_TYPE || "standard",
  };
}

function buildMonitoringRequest({ enrollmentId, enrollmentToken, input }) {
  const mapper = loadMapperModule();
  if (mapper && typeof mapper.buildMonitoringPayload === "function") {
    return mapper.buildMonitoringPayload({ enrollmentId, enrollmentToken, input });
  }
  return {
    enrollmentId: enrollmentId || undefined,
    enrollmentToken: enrollmentToken || undefined,
    memberNumber: getEquifaxMemberNumber() || undefined,
    monitoringEnabled: true,
    alertPreferences: {
      email: Boolean(input?.email),
      sms: Boolean(input?.mobile),
    },
  };
}

function extractEnrollmentId(enrollmentResponse) {
  if (!enrollmentResponse || typeof enrollmentResponse !== "object") return null;
  return (
    enrollmentResponse.enrollmentId ||
    enrollmentResponse.enrollmentID ||
    enrollmentResponse.id ||
    enrollmentResponse.consumerEnrollmentId ||
    enrollmentResponse.data?.enrollmentId ||
    enrollmentResponse.enrollment?.id ||
    null
  );
}

function extractEnrollmentToken(enrollmentResponse) {
  if (!enrollmentResponse || typeof enrollmentResponse !== "object") return null;
  return (
    enrollmentResponse.enrollmentToken ||
    enrollmentResponse.token ||
    enrollmentResponse.jwt ||
    enrollmentResponse.data?.enrollmentToken ||
    null
  );
}

function extractScore(scoreResponse) {
  if (!scoreResponse || typeof scoreResponse !== "object") return null;
  const candidates = [
    scoreResponse.score,
    scoreResponse.creditScore,
    scoreResponse.scoreValue,
    scoreResponse.vantageScore,
    scoreResponse.data?.score,
    scoreResponse.data?.creditScore,
    scoreResponse.scores?.[0]?.score,
    scoreResponse.scores?.[0]?.value,
  ];
  for (const c of candidates) {
    if (c != null && !Number.isNaN(Number(c))) return Number(c);
  }
  return null;
}

module.exports = {
  splitName,
  buildEnrollmentPayload,
  buildScoreRequest,
  buildReportRequest,
  buildMonitoringRequest,
  extractEnrollmentId,
  extractEnrollmentToken,
  extractScore,
  buildDevEnrollmentTemplate,
};
