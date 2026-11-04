/**
 * ============================================================
 * SINGLE CONFIGURATION POINT — Experian India credit-check body
 * ============================================================
 *
 * DO NOT invent PowerCurve / India API field names.
 * Replace `buildOfficialExperianCreditCheckBody` with the EXACT request
 * schema from your Experian India entitlement documentation.
 *
 * Alternatively, set:
 *   EXPERIAN_CREDIT_CHECK_MAPPER_MODULE=./path/to/yourMapper.js
 * where the module exports: module.exports = function map(input) { return {...} }
 *
 * Dev-only connectivity template (NOT for production):
 *   EXPERIAN_CREDIT_CHECK_ALLOW_DEV_TEMPLATE=true
 */

const path = require("path");

/**
 * Official mapper — intentionally throws until configured.
 * @param {object} input - { userId, fullName, pan, mobile, dob, aadhaarLast4, address, consentRef }
 */
function buildOfficialExperianCreditCheckBody(_input) {
  const err = new Error(
    "Experian India credit-check request schema is not configured. " +
      "Implement buildOfficialExperianCreditCheckBody in experianRequestBuilder.js " +
      "using your PowerCurve / India API docs, or set EXPERIAN_CREDIT_CHECK_MAPPER_MODULE."
  );
  err.code = "EXPERIAN_REQUEST_SCHEMA_NOT_CONFIGURED";
  throw err;
}

/**
 * Dev template only — mirrors common applicant identifiers for sandbox connectivity tests.
 * This is NOT claimed to be the official PowerCurve schema.
 */
function buildDevTemplateBody(input) {
  return {
    _warning:
      "DEV TEMPLATE ONLY — replace with official Experian India request schema before go-live",
    applicant: {
      pan: input.pan || null,
      fullName: input.fullName || null,
      dateOfBirth: input.dob || null,
      mobile: input.mobile || null,
      aadhaarLast4: input.aadhaarLast4 || null,
      address: input.address || null,
    },
    consent: {
      given: true,
      reference: input.consentRef || null,
    },
  };
}

function loadExternalMapper() {
  const modulePath = String(process.env.EXPERIAN_CREDIT_CHECK_MAPPER_MODULE || "").trim();
  if (!modulePath) return null;
  const resolved = path.isAbsolute(modulePath)
    ? modulePath
    : path.join(process.cwd(), modulePath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mapper = require(resolved);
  if (typeof mapper !== "function" && typeof mapper?.map !== "function") {
    const err = new Error("EXPERIAN_CREDIT_CHECK_MAPPER_MODULE must export a function or { map }");
    err.code = "EXPERIAN_MAPPER_INVALID";
    throw err;
  }
  return typeof mapper === "function" ? mapper : mapper.map.bind(mapper);
}

/**
 * Builds the Experian India credit-check request body.
 */
function buildExperianCreditCheckRequestBody(input) {
  const external = loadExternalMapper();
  if (external) {
    return external(input);
  }

  const allowDevTemplate =
    String(process.env.EXPERIAN_CREDIT_CHECK_ALLOW_DEV_TEMPLATE || "").toLowerCase() ===
    "true";

  if (allowDevTemplate) {
    console.warn(
      "[EXPERIAN] Using DEV request template. Replace with official India schema before production."
    );
    return buildDevTemplateBody(input);
  }

  return buildOfficialExperianCreditCheckBody(input);
}

module.exports = {
  buildExperianCreditCheckRequestBody,
  buildOfficialExperianCreditCheckBody,
  buildDevTemplateBody,
};
