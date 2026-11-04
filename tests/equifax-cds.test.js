const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CREDIT_CHECK_MODE = "sandbox";
process.env.CIBIL_PROVIDER = "auto";

const {
  resolveEquifaxEnv,
  getEquifaxBaseUrl,
  getEquifaxCdsScopes,
  getEquifaxCdsUrl,
  DEFAULT_CDS_SCOPES,
} = require("../services/credit-bureau/equifaxConfig");
const {
  buildDevEnrollmentTemplate,
  extractEnrollmentId,
  extractScore,
} = require("../services/credit-bureau/equifaxRequestBuilder");
const { resolveCibilBackend } = require("../services/credit-bureau/cibilProvider");
const equifaxProvider = require("../services/credit-bureau/equifaxProvider");
const cibilProvider = require("../services/credit-bureau/cibilProvider");

test("Equifax CDS default scopes match Developer Dashboard products", () => {
  const scopes = getEquifaxCdsScopes();
  assert.equal(scopes.length, 4);
  assert.ok(scopes.some((s) => s.includes("/enrollment")));
  assert.ok(scopes.some((s) => s.includes("/creditScore")));
  assert.ok(scopes.some((s) => s.includes("/creditReport")));
  assert.ok(scopes.some((s) => s.includes("/creditMonitoring")));
  assert.deepEqual(scopes, DEFAULT_CDS_SCOPES);
});

test("Equifax env URLs resolve sandbox/uat/live", () => {
  process.env.EQUIFAX_ENV = "sandbox";
  assert.equal(resolveEquifaxEnv(), "sandbox");
  assert.match(getEquifaxBaseUrl(), /sandbox\.equifax\.com/);
  assert.match(getEquifaxCdsUrl("creditScore"), /\/personal\/consumer-data-suite\/v1\/creditScore$/);

  process.env.EQUIFAX_ENV = "uat";
  assert.equal(resolveEquifaxEnv(), "uat");
  assert.match(getEquifaxBaseUrl(), /uat\.equifax\.com/);

  process.env.EQUIFAX_ENV = "live";
  assert.equal(resolveEquifaxEnv(), "production");
  assert.equal(getEquifaxBaseUrl(), "https://api.equifax.com");
});

test("dev enrollment template maps MoneyTrend applicant fields", () => {
  const payload = buildDevEnrollmentTemplate({
    fullName: "Rajesh Kumar",
    dob: "1995-08-15",
    mobile: "9876543210",
    pan: "ABCDE1234F",
  });
  assert.equal(payload.consumer.name.firstName, "Rajesh");
  assert.equal(payload.consumer.name.lastName, "Kumar");
  assert.equal(payload.consumer.nationalId, "ABCDE1234F");
  assert.equal(payload.consumer.homePhone, "9876543210");
});

test("extract enrollment id and score from CDS-like responses", () => {
  assert.equal(extractEnrollmentId({ enrollmentId: "enr-1" }), "enr-1");
  assert.equal(extractEnrollmentId({ data: { enrollmentId: "enr-2" } }), "enr-2");
  assert.equal(extractScore({ creditScore: 720 }), 720);
  assert.equal(extractScore({ scores: [{ value: 701 }] }), 701);
});

test("CIBIL sandbox uses mock backend", () => {
  process.env.CREDIT_CHECK_MODE = "sandbox";
  process.env.CIBIL_PROVIDER = "auto";
  delete process.env.EQUIFAX_CLIENT_ID;
  delete process.env.EQUIFAX_CLIENT_SECRET;
  assert.equal(resolveCibilBackend(), "mock");
});

test("CIBIL provider can be forced to equifax", () => {
  process.env.CIBIL_PROVIDER = "equifax";
  assert.equal(resolveCibilBackend(), "equifax");
  process.env.CIBIL_PROVIDER = "auto";
});

test("Equifax + CIBIL sandbox fetchCreditReport return normalized scores", async () => {
  process.env.CREDIT_CHECK_MODE = "sandbox";
  const eq = await equifaxProvider.fetchCreditReport({
    pan: "ABCDE1234F",
    fullName: "Test User",
    dob: "1990-01-01",
    mobile: "9876543210",
  });
  assert.equal(eq.bureau, "EQUIFAX");
  assert.ok(eq.score >= 300);

  const cb = await cibilProvider.fetchCreditReport({
    pan: "ABCDE1234F",
    fullName: "Test User",
    dob: "1990-01-01",
    mobile: "9876543210",
  });
  assert.equal(cb.bureau, "CIBIL");
  assert.ok(cb.score >= 300);
});
