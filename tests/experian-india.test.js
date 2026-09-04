const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveExperianEnv,
  getExperianBaseUrl,
  getExperianOAuthTokenUrl,
  getExperianCreditCheckUrl,
} = require("../services/credit-bureau/experianConfig");

const {
  getValidExperianToken,
  getExperianAccessToken,
  refreshExperianAccessToken,
  invalidateExperianToken,
  clearExperianTokenCache,
  cacheTokenResponse,
  getCachedTokenSnapshot,
  __setTokenCacheForTests,
} = require("../services/credit-bureau/experianAuth");

const {
  buildExperianCreditCheckRequestBody,
  buildDevTemplateBody,
} = require("../services/credit-bureau/experianRequestBuilder");

const { createBureauHttpError, fetchWithRetry } = require("../services/credit-bureau/httpClient");
const { deriveScoreBand } = require("../services/creditCheckService");

describe("experianConfig India hosts", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("defaults to India sandbox host", () => {
    delete process.env.EXPERIAN_API_BASE_URL;
    process.env.EXPERIAN_ENV = "sandbox";
    assert.equal(resolveExperianEnv(), "sandbox");
    assert.match(getExperianBaseUrl(), /sandbox-in-api\.experian\.com/);
    assert.equal(
      getExperianOAuthTokenUrl(),
      "https://sandbox-in-api.experian.com/oauth2/v1/token"
    );
  });

  it("rejects US Experian host override", () => {
    process.env.EXPERIAN_API_BASE_URL = "https://sandbox-us-api.experian.com";
    assert.throws(() => getExperianBaseUrl(), /US Experian/);
  });

  it("requires credit-check endpoint for live URL", () => {
    delete process.env.EXPERIAN_CREDIT_CHECK_ENDPOINT;
    assert.throws(() => getExperianCreditCheckUrl(), /EXPERIAN_CREDIT_CHECK_ENDPOINT/);
  });

  it("combines base URL + endpoint path", () => {
    delete process.env.EXPERIAN_API_BASE_URL;
    process.env.EXPERIAN_ENV = "sandbox";
    process.env.EXPERIAN_CREDIT_CHECK_ENDPOINT = "/powercurve/example";
    assert.equal(
      getExperianCreditCheckUrl(),
      "https://sandbox-in-api.experian.com/powercurve/example"
    );
  });
});

describe("experianAuth token cache", () => {
  beforeEach(() => {
    clearExperianTokenCache();
  });

  it("caches access token with early expiry skew", () => {
    const issued = Date.now();
    cacheTokenResponse({
      issued_at: String(issued),
      expires_in: "1800",
      token_type: "Bearer",
      access_token: "test-access",
      refresh_token: "test-refresh",
    });
    const snap = getCachedTokenSnapshot();
    assert.equal(snap.hasAccessToken, true);
    assert.equal(snap.hasRefreshToken, true);
    assert.equal(snap.isValid, true);
    assert.ok(snap.expiresAt < issued + 1800 * 1000);
  });

  it("getValidExperianToken returns cached token when valid", async () => {
    __setTokenCacheForTests({
      accessToken: "cached-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const token = await getValidExperianToken();
    assert.equal(token.accessToken, "cached-token");
    assert.equal(token.fromCache, true);
  });

  it("invalidate clears cache", () => {
    __setTokenCacheForTests({
      accessToken: "x",
      refreshToken: "y",
      expiresAt: Date.now() + 10000,
    });
    invalidateExperianToken();
    assert.equal(getCachedTokenSnapshot().hasAccessToken, false);
  });
});

describe("experianAuth OAuth network (mocked fetch)", () => {
  const prevFetch = global.fetch;
  const prevEnv = { ...process.env };

  beforeEach(() => {
    clearExperianTokenCache();
    process.env.EXPERIAN_USERNAME = "user";
    process.env.EXPERIAN_PASSWORD = "pass";
    process.env.EXPERIAN_CLIENT_ID = "cid";
    process.env.EXPERIAN_CLIENT_SECRET = "csecret";
    process.env.EXPERIAN_ENV = "sandbox";
    delete process.env.EXPERIAN_API_BASE_URL;
  });

  afterEach(() => {
    global.fetch = prevFetch;
    process.env = { ...prevEnv };
    clearExperianTokenCache();
  });

  it("password grant stores access token", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        issued_at: String(Date.now()),
        expires_in: "1800",
        token_type: "Bearer",
        access_token: "live-access",
        refresh_token: "live-refresh",
      }),
    });
    const token = await getExperianAccessToken();
    assert.equal(token.accessToken, "live-access");
  });

  it("maps OAuth 401 to EXPERIAN_OAUTH_UNAUTHORIZED", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_client"}',
    });
    await assert.rejects(() => getExperianAccessToken(), (err) => {
      assert.equal(err.code, "EXPERIAN_OAUTH_UNAUTHORIZED");
      return true;
    });
  });

  it("refresh falls back to password grant when refresh fails", async () => {
    __setTokenCacheForTests({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() - 1000,
    });
    let calls = 0;
    global.fetch = async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (body.grant_type === "refresh_token") {
        return { ok: false, status: 400, text: async () => "bad refresh" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          issued_at: String(Date.now()),
          expires_in: "1800",
          access_token: "new-password-token",
          refresh_token: "new-rt",
          token_type: "Bearer",
        }),
      };
    };
    const token = await refreshExperianAccessToken();
    assert.equal(token.accessToken, "new-password-token");
    assert.ok(calls >= 2);
  });
});

describe("experianRequestBuilder", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("throws when official schema not configured", () => {
    delete process.env.EXPERIAN_CREDIT_CHECK_MAPPER_MODULE;
    delete process.env.EXPERIAN_CREDIT_CHECK_ALLOW_DEV_TEMPLATE;
    assert.throws(
      () => buildExperianCreditCheckRequestBody({ pan: "ABCDE1234F" }),
      (err) => err.code === "EXPERIAN_REQUEST_SCHEMA_NOT_CONFIGURED"
    );
  });

  it("allows explicit dev template when enabled", () => {
    process.env.EXPERIAN_CREDIT_CHECK_ALLOW_DEV_TEMPLATE = "true";
    const body = buildExperianCreditCheckRequestBody({
      pan: "ABCDE1234F",
      fullName: "Test User",
      dob: "1995-01-15",
      mobile: "9876543210",
      consentRef: "check-1",
    });
    assert.equal(body.applicant.pan, "ABCDE1234F");
    assert.ok(body._warning);
    assert.deepEqual(buildDevTemplateBody({ pan: "X" }).applicant.pan, "X");
  });
});

describe("httpClient bureau errors + 401 retry", () => {
  const prevFetch = global.fetch;

  afterEach(() => {
    global.fetch = prevFetch;
  });

  it("maps status codes", () => {
    assert.equal(createBureauHttpError(401).code, "BUREAU_UNAUTHORIZED");
    assert.equal(createBureauHttpError(429).code, "BUREAU_RATE_LIMITED");
    assert.equal(createBureauHttpError(503).code, "BUREAU_UNAVAILABLE");
  });

  it("retries once on 401 via onUnauthorized", async () => {
    let calls = 0;
    global.fetch = async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 401,
          headers: { get: () => "application/json" },
          text: async () => "expired",
        };
      }
      assert.match(options.headers.Authorization, /Bearer fresh-token/);
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      };
    };

    const result = await fetchWithRetry(
      "https://example.test/api",
      { method: "POST", headers: { Authorization: "Bearer old" } },
      {
        onUnauthorized: async () => ({
          headers: { Authorization: "Bearer fresh-token" },
        }),
      }
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  });
});

describe("score band labeling", () => {
  it("labels Experian scores without calling them CIBIL", () => {
    assert.equal(deriveScoreBand("EXPERIAN", 742), "VERY_GOOD");
    assert.equal(deriveScoreBand("EXPERIAN", 718), "GOOD");
    assert.equal(deriveScoreBand("EXPERIAN", 500), "POOR");
  });
});
