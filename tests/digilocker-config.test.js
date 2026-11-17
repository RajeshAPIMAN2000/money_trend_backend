const test = require("node:test");
const assert = require("node:assert/strict");

test("default DigiLocker URLs follow Meri Pehchaan v2.4 paths", () => {
  const prev = { ...process.env };
  delete process.env.DIGILOCKER_AUTHORIZE_URL;
  delete process.env.DIGILOCKER_TOKEN_URL;
  delete process.env.DIGILOCKER_CLIENT_ID;
  process.env.DIGILOCKER_CLIENT_SECRET = "";
  process.env.DIGILOCKER_STUB = "false";

  // Clear require cache so config re-reads env
  delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
  const { getDigilockerConfig } = require("../services/digilocker/digilockerConfig");
  const cfg = getDigilockerConfig();

  // MoneyTrend partner registration uses /oauth2/2/authorize
  assert.match(cfg.authorizeUrl, /\/oauth2\/2\/authorize$/);
  assert.match(cfg.tokenUrl, /\/oauth2\/2\/token$/);
  assert.match(cfg.userDetailsUrl, /\/oauth2\/1\/user$/);
  assert.match(cfg.issuedDocsUrl, /\/oauth2\/2\/files\/issued$/);
  assert.match(cfg.eaadhaarXmlUrl, /\/oauth2\/3\/xml\/eaadhaar$/);
  assert.equal(cfg.stubMode, true); // empty secret → stub
  assert.equal(cfg.clientId, "BN6CF9DE38");

  Object.assign(process.env, prev);
  delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
});

test("authorize URL can be overridden via env when partner confirms /2/", () => {
  const prevAuth = process.env.DIGILOCKER_AUTHORIZE_URL;
  process.env.DIGILOCKER_AUTHORIZE_URL =
    "https://digilocker.meripehchaan.gov.in/public/oauth2/2/authorize";
  delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
  const { getDigilockerConfig } = require("../services/digilocker/digilockerConfig");
  const cfg = getDigilockerConfig();
  assert.match(cfg.authorizeUrl, /\/oauth2\/2\/authorize$/);
  if (prevAuth === undefined) delete process.env.DIGILOCKER_AUTHORIZE_URL;
  else process.env.DIGILOCKER_AUTHORIZE_URL = prevAuth;
  delete require.cache[require.resolve("../services/digilocker/digilockerConfig")];
});
