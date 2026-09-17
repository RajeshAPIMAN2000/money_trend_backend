const test = require("node:test");
const assert = require("node:assert/strict");

test("Equifax env resolves sandbox/test/live hosts", () => {
  const { resolveEquifaxEnv, getEquifaxBaseUrl } = require("../services/equifax/equifaxConfig");
  process.env.EQUIFAX_ENV = "sandbox";
  delete process.env.EQUIFAX_BASE_URL;
  assert.equal(resolveEquifaxEnv(), "sandbox");
  assert.match(getEquifaxBaseUrl(), /api\.sandbox\.equifax\.com/);

  process.env.EQUIFAX_ENV = "test";
  assert.equal(resolveEquifaxEnv(), "test");
  assert.match(getEquifaxBaseUrl(), /api\.uat\.equifax\.com/);

  process.env.EQUIFAX_ENV = "live";
  assert.equal(resolveEquifaxEnv(), "live");
  assert.equal(getEquifaxBaseUrl(), "https://api.equifax.com");
});

test("validateEquifaxReady requires crypto material", () => {
  process.env.EQUIFAX_ENABLED = "true";
  process.env.EQUIFAX_ENV = "sandbox";
  delete process.env.EQUIFAX_BASE_URL;
  delete process.env.EQUIFAX_SYMMETRIC_KEY;
  delete process.env.EQUIFAX_BASE64_PRIVATE_KEY;

  const { validateEquifaxReady } = require("../services/equifax/equifaxConfig");
  assert.throws(
    () => validateEquifaxReady("enrollment"),
    (err) => err.code === "EQUIFAX_CONFIG_INCOMPLETE"
  );
});

test("extractAssertion and extractAccessToken", () => {
  const { extractAssertion, extractAccessToken, toFormBody } = require("../services/equifax/equifaxCrypto");
  assert.equal(extractAssertion({ assertion: "abc.jwt" }), "abc.jwt");
  assert.equal(extractAssertion({ client_assertion: "xyz" }), "xyz");
  assert.equal(extractAccessToken({ access_token: "tok", expires_in: 59 }), "tok");
  const form = toFormBody({ scope: "enrollment", grant_type: "jwt-bearer", api_key: "mock_enrollment" });
  assert.match(form, /grant_type=jwt-bearer/);
  assert.match(form, /scope=enrollment/);
});

test("mapEquifaxError maps invalid_token and 404.01", () => {
  const { mapEquifaxError } = require("../services/equifax/equifaxError");
  const a = mapEquifaxError({
    status: 401,
    details: "<InvalidTokenException><error>invalid_token</error></InvalidTokenException>",
  });
  assert.equal(a.code, "EQUIFAX_INVALID_TOKEN");

  const b = mapEquifaxError({
    status: 404,
    details: '{"efxErrorCode":404.01,"description":"Not Found - The specified resource does not exist"}',
  });
  assert.equal(b.code, "EQUIFAX_RESOURCE_NOT_FOUND");
});

test("pickScore does not invent values", () => {
  const { pickScore } = require("../services/equifax/creditScoreService");
  assert.deepEqual(pickScore(null).score, null);
  assert.equal(pickScore({ score: 720, scoreType: "Vantage" }).score, 720);
});

test("normalizeAlert requires alertId", () => {
  const { normalizeAlert } = require("../services/equifax/creditMonitoringService");
  assert.equal(normalizeAlert({ type: "INQUIRY" }), null);
  assert.equal(normalizeAlert({ alertId: "a1", alertType: "INQUIRY" }).alertId, "a1");
});

test("token cache clears independently", () => {
  const auth = require("../services/equifax/equifaxAuth");
  auth._caches.enrollment.accessToken = "e";
  auth._caches.delivery.accessToken = "d";
  auth.clearCachedEquifaxCredential("enrollment");
  assert.equal(auth._caches.enrollment.accessToken, null);
  assert.equal(auth._caches.delivery.accessToken, "d");
  auth.clearCachedEquifaxCredential();
  assert.equal(auth._caches.delivery.accessToken, null);
});
