const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Ensure DigiLocker test credentials win over empty placeholders in .env
 * (dotenv may already have loaded empty DIGILOCKER_CLIENT_SECRET).
 */
function withDigilockerTestEnv(fn) {
  const keys = [
    "DIGILOCKER_CLIENT_ID",
    "DIGILOCKER_CLIENT_SECRET",
    "DIGILOCKER_STUB",
    "DIGILOCKER_REDIRECT_URI",
  ];
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];

  process.env.DIGILOCKER_CLIENT_ID = "BN6CF9DE38";
  process.env.DIGILOCKER_CLIENT_SECRET = "test-secret-not-real";
  process.env.DIGILOCKER_STUB = "false";
  process.env.DIGILOCKER_REDIRECT_URI = "https://moneytrend.in/api/digilocker/callback";

  delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
  delete require.cache[require.resolve("../services/digilocker/digilockerService")];
  const service = require("../services/digilocker/digilockerService");

  return Promise.resolve()
    .then(() => fn(service))
    .finally(() => {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
      delete require.cache[require.resolve("../services/digilocker/digilockerService")];
    });
}

test("successful token exchange returns access_token", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.match(String(options.body), /grant_type=authorization_code/);
    assert.match(String(options.body), /code_verifier=/);
    assert.match(String(options.body), /client_secret=/);
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "opaque-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: "a.b.c",
        }),
    };
  };

  try {
    await withDigilockerTestEnv(async ({ exchangeAuthorizationCode }) => {
      // Re-assert after module load in case dotenv mutated env during require
      process.env.DIGILOCKER_CLIENT_SECRET = "test-secret-not-real";
      process.env.DIGILOCKER_CLIENT_ID = "BN6CF9DE38";
      const json = await exchangeAuthorizationCode({
        code: "auth-code",
        codeVerifier: "verifier-value",
        redirectUri: "https://moneytrend.in/api/digilocker/callback",
      });
      assert.equal(json.access_token, "opaque-access-token");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("invalid token JSON is rejected", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "not-json",
  });

  try {
    await withDigilockerTestEnv(async ({ exchangeAuthorizationCode }) => {
      process.env.DIGILOCKER_CLIENT_SECRET = "test-secret-not-real";
      await assert.rejects(
        () =>
          exchangeAuthorizationCode({
            code: "x",
            codeVerifier: "y",
            redirectUri: "https://moneytrend.in/api/digilocker/callback",
          }),
        (err) => err.code === "DIGILOCKER_TOKEN_INVALID"
      );
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("provider error without access_token fails", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }),
  });

  try {
    await withDigilockerTestEnv(async ({ exchangeAuthorizationCode }) => {
      process.env.DIGILOCKER_CLIENT_SECRET = "test-secret-not-real";
      await assert.rejects(
        () =>
          exchangeAuthorizationCode({
            code: "x",
            codeVerifier: "y",
            redirectUri: "https://moneytrend.in/api/digilocker/callback",
          }),
        (err) => err.code === "DIGILOCKER_TOKEN_FAILED"
      );
    });
  } finally {
    global.fetch = originalFetch;
  }
});
