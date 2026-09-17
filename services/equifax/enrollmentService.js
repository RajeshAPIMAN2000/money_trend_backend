/**
 * Consumer Enrollment APIs (enrollment_token scope).
 * Supports local MOCK_SANDBOX when Equifax keys are not configured.
 */

const { equifaxRequest } = require("./equifaxClient");
const { upsertEnrollment, getEnrollmentByUserId } = require("./enrollmentRepository");
const { writeAuditLog } = require("../../utils/audit");
const { isEquifaxMockMode } = require("./equifaxConfig");
const { mockEnrollmentId } = require("./equifaxMock");

const KNOWN_FEATURE_CODES = ["ONE_B_SCORE", "ONE_B_REPORT", "THREE_B_CREDIT_MONITORING_OFFLINE"];

function extractEnrollmentId(raw) {
  if (!raw || typeof raw !== "object") return null;
  return (
    raw.enrollmentId ||
    raw.enrollmentID ||
    raw.id ||
    raw.data?.enrollmentId ||
    raw.data?.id ||
    null
  );
}

function buildEnrollmentSubject(input = {}) {
  const subject = input.enrollmentSubject || input.subject || {};
  if (input.enrollmentSubject) {
    return { enrollmentSubject: input.enrollmentSubject, ...input.extra };
  }
  if (subject && Object.keys(subject).length) return subject;
  if (input.rawBody && typeof input.rawBody === "object") return input.rawBody;

  const err = new Error(
    "Enrollment requires enrollmentSubject (or rawBody) matching Equifax EnrollmentSubject schema from the API docs"
  );
  err.code = "EQUIFAX_VALIDATION_ERROR";
  err.status = 400;
  throw err;
}

function hasUsableSubject(input = {}) {
  const s = input.enrollmentSubject || input.subject || input.rawBody || {};
  if (!s || typeof s !== "object") return false;
  return Object.keys(s).length > 0;
}

async function listAvailableFeatures() {
  if (isEquifaxMockMode()) {
    return {
      data: KNOWN_FEATURE_CODES.map((code) => ({ featureCode: code })),
      correlationId: "mock",
    };
  }
  return equifaxRequest({
    method: "GET",
    path: "/personal/consumer-data-suite/v1/enrollment/features",
    tokenKind: "enrollment",
    operation: "enrollment.features.list",
  });
}

async function getEnrollmentFeatures(enrollmentId) {
  if (isEquifaxMockMode()) {
    return {
      data: KNOWN_FEATURE_CODES.map((code) => ({ featureCode: code })),
      correlationId: "mock",
    };
  }
  return equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/enrollment/${encodeURIComponent(enrollmentId)}/features`,
    tokenKind: "enrollment",
    operation: "enrollment.features.get",
  });
}

async function activateFeature(enrollmentId, featureCode) {
  const code = String(featureCode || "").trim().toUpperCase();
  if (!code) {
    const err = new Error("featureCode is required");
    err.code = "EQUIFAX_VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  if (isEquifaxMockMode()) {
    return { featureCode: code, data: { status: "ACTIVE" }, correlationId: "mock" };
  }

  const available = await listAvailableFeatures();
  const list = Array.isArray(available.data)
    ? available.data
    : available.data?.features || available.data?.featureCodes || [];
  const codes = list
    .map((f) => (typeof f === "string" ? f : f.featureCode || f.code || f.name))
    .filter(Boolean)
    .map((c) => String(c).toUpperCase());

  if (codes.length && !codes.includes(code)) {
    const err = new Error(`Feature ${code} is not available for this Equifax application`);
    err.code = "EQUIFAX_FORBIDDEN";
    err.status = 403;
    throw err;
  }

  const result = await equifaxRequest({
    method: "POST",
    path: `/personal/consumer-data-suite/v1/enrollment/${encodeURIComponent(enrollmentId)}/features/${encodeURIComponent(code)}`,
    tokenKind: "enrollment",
    operation: "enrollment.features.activate",
    retryOn401: true,
  });
  return { featureCode: code, ...result };
}

async function enrollConsumerForUser(userId, input = {}, { activateFeatures = true } = {}) {
  const existing = await getEnrollmentByUserId(userId);
  if (existing?.equifax_enrollment_id && !input.force) {
    return {
      enrollment: {
        id: existing.id,
        equifax_enrollment_id: existing.equifax_enrollment_id,
        status: existing.status,
        features: existing.features,
        last_synced_at: existing.last_synced_at,
        is_mock: String(existing.equifax_enrollment_id || "").startsWith("MOCK-"),
      },
      idempotent: true,
    };
  }

  if (!hasUsableSubject(input) && !input.rawBody) {
    const err = new Error(
      "Enrollment requires enrollmentSubject (or rawBody). Include consumer identity fields from Equifax docs."
    );
    err.code = "EQUIFAX_VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  if (isEquifaxMockMode()) {
    const enrollmentId = mockEnrollmentId(userId);
    const wanted =
      Array.isArray(input.featureCodes) && input.featureCodes.length
        ? input.featureCodes.map((c) => String(c).toUpperCase())
        : KNOWN_FEATURE_CODES;

    await upsertEnrollment({
      userId,
      equifaxEnrollmentId: enrollmentId,
      customerReferenceNumber:
        input.customerReferenceNumber || input.customer_reference_number || null,
      status: "ACTIVE",
      featuresJson: wanted,
      metaJson: { mock: true, data_source: "MOCK_SANDBOX" },
    });

    await writeAuditLog({
      userId,
      action: "EQUIFAX_ENROLLMENT",
      entityType: "equifax_enrollment",
      entityId: enrollmentId,
      meta: { features: wanted, mock: true },
    });

    console.log("[EQUIFAX] mock enrollment created", { userId, enrollmentId });

    const stored = await getEnrollmentByUserId(userId);
    return {
      enrollment: {
        id: stored.id,
        equifax_enrollment_id: stored.equifax_enrollment_id,
        status: stored.status,
        features: stored.features,
        last_synced_at: stored.last_synced_at,
        is_mock: true,
        data_source: "MOCK_SANDBOX",
      },
      correlationId: "mock",
      idempotent: false,
    };
  }

  const body = buildEnrollmentSubject(input);
  const result = await equifaxRequest({
    method: "POST",
    path: "/personal/consumer-data-suite/v1/enrollment",
    body,
    tokenKind: "enrollment",
    operation: "enrollment.create",
    retryOn401: true,
  });

  const enrollmentId = extractEnrollmentId(result.data);
  if (!enrollmentId) {
    const err = new Error("Equifax enrollment response missing enrollmentId");
    err.code = "EQUIFAX_ENROLLMENT_ID_MISSING";
    err.status = 502;
    throw err;
  }

  const activated = [];
  if (activateFeatures !== false) {
    const wanted =
      Array.isArray(input.featureCodes) && input.featureCodes.length
        ? input.featureCodes
        : KNOWN_FEATURE_CODES;
    for (const code of wanted) {
      try {
        await activateFeature(enrollmentId, code);
        activated.push(String(code).toUpperCase());
      } catch (e) {
        console.log("[EQUIFAX] feature activation skipped", { feature: code, code: e.code });
      }
    }
  }

  await upsertEnrollment({
    userId,
    equifaxEnrollmentId: String(enrollmentId),
    customerReferenceNumber:
      input.customerReferenceNumber || input.customer_reference_number || null,
    status: "ACTIVE",
    featuresJson: activated,
    metaJson: { correlationId: result.correlationId },
  });

  await writeAuditLog({
    userId,
    action: "EQUIFAX_ENROLLMENT",
    entityType: "equifax_enrollment",
    entityId: enrollmentId,
    meta: { features: activated },
  });

  const stored = await getEnrollmentByUserId(userId);
  return {
    enrollment: {
      id: stored.id,
      equifax_enrollment_id: stored.equifax_enrollment_id,
      status: stored.status,
      features: stored.features,
      last_synced_at: stored.last_synced_at,
    },
    correlationId: result.correlationId,
    idempotent: false,
  };
}

async function getEnrollmentRemote(enrollmentId) {
  if (isEquifaxMockMode()) {
    return { data: { enrollmentId, status: "ACTIVE", is_mock: true }, correlationId: "mock" };
  }
  return equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/enrollment/${encodeURIComponent(enrollmentId)}`,
    tokenKind: "enrollment",
    operation: "enrollment.get",
  });
}

async function getEnrollmentByCrn(customerReferenceNumber) {
  if (isEquifaxMockMode()) {
    return { data: { customerReferenceNumber, is_mock: true }, correlationId: "mock" };
  }
  return equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/enrollment/crn/${encodeURIComponent(customerReferenceNumber)}`,
    tokenKind: "enrollment",
    operation: "enrollment.getByCrn",
  });
}

async function getStoredEnrollment(userId) {
  return getEnrollmentByUserId(userId);
}

module.exports = {
  KNOWN_FEATURE_CODES,
  enrollConsumerForUser,
  getStoredEnrollment,
  getEnrollmentRemote,
  getEnrollmentByCrn,
  listAvailableFeatures,
  getEnrollmentFeatures,
  activateFeature,
  extractEnrollmentId,
  buildEnrollmentSubject,
};
