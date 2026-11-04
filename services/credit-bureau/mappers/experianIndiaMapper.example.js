/**
 * OPTIONAL: Official Experian India request mapper template.
 *
 * Copy this file, fill in the EXACT PowerCurve / India schema from your docs,
 * then set in .env:
 *   EXPERIAN_CREDIT_CHECK_MAPPER_MODULE=services/credit-bureau/mappers/experianIndiaMapper.example.js
 *
 * Or rename/replace this module and point EXPERIAN_CREDIT_CHECK_MAPPER_MODULE at it.
 *
 * @param {object} input
 * @param {string} input.pan
 * @param {string} input.fullName
 * @param {string|null} input.dob
 * @param {string|null} input.mobile
 * @param {string|null} input.aadhaarLast4
 * @param {object|null} input.address
 * @param {string|null} input.consentRef
 * @returns {object} Exact Experian India request body
 */
module.exports = function mapExperianIndiaRequest(input) {
  // TODO: replace with official schema from Experian India entitlement documentation.
  throw Object.assign(
    new Error(
      "Replace this mapper with the official Experian India request schema from your PowerCurve docs"
    ),
    { code: "EXPERIAN_REQUEST_SCHEMA_NOT_CONFIGURED" }
  );
};
