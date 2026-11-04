/**
 * Equifax Consumer Data Suite (CES / CDS) environment config.
 * Scopes come from the Equifax Developer Dashboard (pending → approved → live).
 *
 * Sandbox: https://api.sandbox.equifax.com
 * Test/UAT: https://api.uat.equifax.com
 * Live:     https://api.equifax.com
 */

const EQUIFAX_BASE_URLS = {
  sandbox: process.env.EQUIFAX_SANDBOX_BASE_URL || "https://api.sandbox.equifax.com",
  uat: process.env.EQUIFAX_UAT_BASE_URL || "https://api.uat.equifax.com",
  production: process.env.EQUIFAX_PRODUCTION_BASE_URL || "https://api.equifax.com",
};

/** Dashboard scopes the client listed (space-delimited for OAuth). */
const DEFAULT_CDS_SCOPES = [
  "https://api.equifax.com/personal/consumer-data-suite/v1/enrollment",
  "https://api.equifax.com/personal/consumer-data-suite/v1/creditScore",
  "https://api.equifax.com/personal/consumer-data-suite/v1/creditReport",
  "https://api.equifax.com/personal/consumer-data-suite/v1/creditMonitoring",
];

const CDS_PATHS = {
  enrollment: "/personal/consumer-data-suite/v1/enrollment",
  creditScore: "/personal/consumer-data-suite/v1/creditScore",
  creditReport: "/personal/consumer-data-suite/v1/creditReport",
  creditMonitoring: "/personal/consumer-data-suite/v1/creditMonitoring",
};

function resolveEquifaxEnv() {
  const raw = String(
    process.env.EQUIFAX_ENV || process.env.CREDIT_CHECK_MODE || "sandbox"
  )
    .trim()
    .toLowerCase();

  if (raw === "prod" || raw === "live" || raw === "production" || raw === "equifax_live") {
    return "production";
  }
  if (raw === "uat" || raw === "test" || raw === "staging") return "uat";
  return "sandbox";
}

function getEquifaxBaseUrl() {
  if (process.env.EQUIFAX_API_BASE_URL && String(process.env.EQUIFAX_API_BASE_URL).trim()) {
    return String(process.env.EQUIFAX_API_BASE_URL).trim().replace(/\/+$/, "");
  }
  const env = resolveEquifaxEnv();
  return String(EQUIFAX_BASE_URLS[env] || EQUIFAX_BASE_URLS.sandbox).replace(/\/+$/, "");
}

function getEquifaxOAuthTokenUrl() {
  if (process.env.EQUIFAX_OAUTH_TOKEN_URL && String(process.env.EQUIFAX_OAUTH_TOKEN_URL).trim()) {
    return String(process.env.EQUIFAX_OAUTH_TOKEN_URL).trim();
  }
  const path = String(process.env.EQUIFAX_OAUTH_TOKEN_PATH || "/v1/oauth/token").trim();
  const base = getEquifaxBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function getEquifaxCdsScopes() {
  const raw = String(process.env.EQUIFAX_CDS_SCOPES || "").trim();
  if (raw) {
    return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [...DEFAULT_CDS_SCOPES];
}

function getEquifaxCdsUrl(resource) {
  const overrideKey = {
    enrollment: "EQUIFAX_ENROLLMENT_PATH",
    creditScore: "EQUIFAX_CREDIT_SCORE_PATH",
    creditReport: "EQUIFAX_CREDIT_REPORT_PATH",
    creditMonitoring: "EQUIFAX_CREDIT_MONITORING_PATH",
  }[resource];

  const pathOverride = overrideKey ? String(process.env[overrideKey] || "").trim() : "";
  const path = pathOverride || CDS_PATHS[resource];
  if (!path) {
    const err = new Error(`Unknown Equifax CDS resource: ${resource}`);
    err.code = "EQUIFAX_UNKNOWN_RESOURCE";
    throw err;
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `${getEquifaxBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function assertEquifaxCredentialsConfigured() {
  const { validateEquifaxReady } = require("../equifax/equifaxConfig");
  validateEquifaxReady("delivery");
}

function isEquifaxLiveMode() {
  const mode = String(process.env.CREDIT_CHECK_MODE || "sandbox").toLowerCase();
  return ["live", "production", "uat", "test", "equifax_live"].includes(mode);
}

function getEquifaxMemberNumber() {
  return String(process.env.EQUIFAX_MEMBER_NUMBER || process.env.EQUIFAX_CUSTOMER_NUMBER || "").trim() || null;
}

module.exports = {
  EQUIFAX_BASE_URLS,
  DEFAULT_CDS_SCOPES,
  CDS_PATHS,
  resolveEquifaxEnv,
  getEquifaxBaseUrl,
  getEquifaxOAuthTokenUrl,
  getEquifaxCdsScopes,
  getEquifaxCdsUrl,
  assertEquifaxCredentialsConfigured,
  isEquifaxLiveMode,
  getEquifaxMemberNumber,
};
