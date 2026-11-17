/**
 * DigiLocker / Meri Pehchaan partner configuration.
 *
 * MoneyTrend partner registration (PROD):
 * - Client ID: BN6CF9DE38
 * - Issuer ID: in.moneytrend
 * - Callback (must match DigiLocker partner portal exactly):
 *   https://moneytrend.in/api/digilocker/callback
 * - Frontend (production): https://www.moneytrend.in
 * - Local frontend testing: http://localhost:5173
 * - Authorize: /public/oauth2/2/authorize (partner-confirmed for this client)
 * - Token: /public/oauth2/2/token
 *
 * Client secret must never be exposed to the frontend.
 */

function trimSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function envFlag(name, defaultFalse = true) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return !defaultFalse ? false : false;
  return ["1", "true", "yes", "on"].includes(raw);
}

function getDigilockerConfig() {
  const clientId = String(process.env.DIGILOCKER_CLIENT_ID || "BN6CF9DE38").trim();
  // Never hardcode the client secret — empty means stub / misconfigured live mode
  const clientSecret = String(process.env.DIGILOCKER_CLIENT_SECRET || "").trim();
  const issuerId = String(process.env.DIGILOCKER_ISSUER_ID || "in.moneytrend").trim();
  const redirectUri = String(
    process.env.DIGILOCKER_REDIRECT_URI || "https://moneytrend.in/api/digilocker/callback"
  ).trim();

  // Partner portal for MoneyTrend uses /oauth2/2/authorize. Override only if DigiLocker support says otherwise.
  const authorizeUrl = String(
    process.env.DIGILOCKER_AUTHORIZE_URL ||
      "https://digilocker.meripehchaan.gov.in/public/oauth2/2/authorize"
  ).trim();

  const tokenUrl = String(
    process.env.DIGILOCKER_TOKEN_URL ||
      "https://digilocker.meripehchaan.gov.in/public/oauth2/2/token"
  ).trim();

  const userDetailsUrl = String(
    process.env.DIGILOCKER_USER_URL ||
      "https://digilocker.meripehchaan.gov.in/public/oauth2/1/user"
  ).trim();

  const issuedDocsUrl = String(
    process.env.DIGILOCKER_ISSUED_DOCS_URL ||
      "https://digilocker.meripehchaan.gov.in/public/oauth2/2/files/issued"
  ).trim();

  const eaadhaarXmlUrl = String(
    process.env.DIGILOCKER_EAADHAAR_URL ||
      "https://digilocker.meripehchaan.gov.in/public/oauth2/3/xml/eaadhaar"
  ).trim();

  // Revoke endpoint — not confirmed in current partner doc set; leave empty until DigiLocker grants it.
  const revokeUrl = String(process.env.DIGILOCKER_REVOKE_URL || "").trim() || null;

  // JWKS for id_token signature — outstanding partner requirement until URL is provided.
  const jwksUrl = String(process.env.DIGILOCKER_JWKS_URL || "").trim() || null;

  // Prefer explicit DigiLocker frontend base. If FRONTEND_ORIGIN is a CSV, take the first entry.
  const frontendOriginRaw = String(
    process.env.DIGILOCKER_FRONTEND_BASE_URL ||
      process.env.FRONTEND_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      "https://www.moneytrend.in"
  )
    .split(",")[0]
    .trim();
  const frontendBase = trimSlash(frontendOriginRaw);

  const successUrl = String(
    process.env.DIGILOCKER_FRONTEND_SUCCESS_URL ||
      process.env.DIGILOCKER_SUCCESS_URL ||
      `${frontendBase}/onboarding/kyc/digilocker?status=success`
  ).trim();
  const failureUrl = String(
    process.env.DIGILOCKER_FRONTEND_FAILURE_URL ||
      process.env.DIGILOCKER_FAILURE_URL ||
      `${frontendBase}/onboarding/kyc/digilocker?status=error`
  ).trim();
  const nomineeUrl = String(
    process.env.DIGILOCKER_FRONTEND_NOMINEE_URL ||
      `${frontendBase}/onboarding/nominee`
  ).trim();

  const stubForced = envFlag("DIGILOCKER_STUB", false);
  const credentialsReady = Boolean(clientId && clientSecret && redirectUri);
  const stubMode = stubForced || !credentialsReady;

  const sessionTtlMinutes = Math.max(
    Number(process.env.DIGILOCKER_SESSION_TTL_MINUTES || 15),
    5
  );

  const scope = String(process.env.DIGILOCKER_SCOPE || "openid").trim() || "openid";
  const acr = String(process.env.DIGILOCKER_ACR || "").trim().toLowerCase() || null;
  const purpose = String(process.env.DIGILOCKER_PURPOSE || "kyc_verification").trim();

  return {
    clientId,
    clientSecret,
    issuerId,
    redirectUri,
    authorizeUrl,
    tokenUrl,
    userDetailsUrl,
    issuedDocsUrl,
    eaadhaarXmlUrl,
    revokeUrl,
    jwksUrl,
    successUrl,
    failureUrl,
    nomineeUrl,
    stubMode,
    credentialsReady,
    sessionTtlMinutes,
    scope,
    acr: ["pan", "aadhaar", "driving_licence"].includes(acr) ? acr : null,
    purpose,
    httpTimeoutMs: Math.max(Number(process.env.DIGILOCKER_HTTP_TIMEOUT_MS || 20000), 5000),
    // Journey default: auto-approve when all required checks pass
    autoApprove: !["0", "false", "no"].includes(
      String(process.env.DIGILOCKER_AUTO_APPROVE ?? "true").trim().toLowerCase()
    ),
    requireAadhaar: !["0", "false", "no"].includes(
      String(process.env.DIGILOCKER_REQUIRE_AADHAAR || "true").trim().toLowerCase()
    ),
    requirePan: !["0", "false", "no"].includes(
      String(process.env.DIGILOCKER_REQUIRE_PAN || "true").trim().toLowerCase()
    ),
    requireNameMatch: !["0", "false", "no"].includes(
      String(process.env.DIGILOCKER_REQUIRE_NAME_MATCH || "true").trim().toLowerCase()
    ),
    requireDobMatch: envFlag("DIGILOCKER_REQUIRE_DOB_MATCH", false),
  };
}

function assertLiveConfig(cfg) {
  if (!cfg.clientId) {
    const err = new Error("DIGILOCKER_CLIENT_ID is not configured");
    err.code = "DIGILOCKER_CONFIG";
    throw err;
  }
  if (!cfg.clientSecret) {
    const err = new Error("DIGILOCKER_CLIENT_SECRET is not configured");
    err.code = "DIGILOCKER_CONFIG";
    throw err;
  }
  if (!cfg.redirectUri) {
    const err = new Error("DIGILOCKER_REDIRECT_URI is not configured");
    err.code = "DIGILOCKER_CONFIG";
    throw err;
  }
}

module.exports = {
  getDigilockerConfig,
  assertLiveConfig,
};
