/**
 * Example Equifax CDS mapper — replace with field names from your Equifax API Reference
 * after logging into the Developer Dashboard.
 *
 * Set:
 *   EQUIFAX_CDS_MAPPER_MODULE=services/credit-bureau/mappers/equifaxCdsMapper.example.js
 *   EQUIFAX_CDS_ALLOW_DEV_TEMPLATE=false
 */

function splitName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "UNKNOWN", lastName: "UNKNOWN" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function buildEnrollmentPayload(input) {
  const { firstName, lastName } = splitName(input.fullName);
  return {
    // Align these keys with Equifax Consumer Enrollment API Reference
    consumer: {
      name: { firstName, lastName },
      dateOfBirth: input.dob,
      homePhone: input.mobile,
      nationalId: input.pan,
    },
    consent: {
      given: true,
      reference: input.consentRef || null,
      timestamp: new Date().toISOString(),
    },
  };
}

function buildCreditScorePayload({ enrollmentId, enrollmentToken }) {
  return { enrollmentId, enrollmentToken };
}

function buildCreditReportPayload({ enrollmentId, enrollmentToken }) {
  return { enrollmentId, enrollmentToken };
}

function buildMonitoringPayload({ enrollmentId, enrollmentToken }) {
  return { enrollmentId, enrollmentToken, monitoringEnabled: true };
}

module.exports = {
  buildEnrollmentPayload,
  buildCreditScorePayload,
  buildCreditReportPayload,
  buildMonitoringPayload,
};
