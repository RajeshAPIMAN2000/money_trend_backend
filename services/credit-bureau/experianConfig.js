/**
 * Experian India API environment configuration.
 * Uses India hosts only — never US (sandbox-us-api.experian.com).
 */

const EXPERIAN_INDIA_BASE_URLS = {
  sandbox: process.env.EXPERIAN_SANDBOX_BASE_URL || "https://sandbox-in-api.experian.com",
  uat: process.env.EXPERIAN_UAT_BASE_URL || "https://uat-in-api.experian.com",
  production: process.env.EXPERIAN_PRODUCTION_BASE_URL || "https://in-api.experian.com",
};

function resolveExperianEnv() {
  const raw = String(
    process.env.EXPERIAN_ENV || process.env.CREDIT_CHECK_MODE || "sandbox"
  )
    .trim()
    .toLowerCase();

  if (raw === "prod" || raw === "live" || raw === "production") return "production";
  if (raw === "uat" || raw === "staging") return "uat";
  return "sandbox";
}

function getExperianBaseUrl() {
  // Prefer explicit override, then env-specific India URL.
  if (process.env.EXPERIAN_API_BASE_URL && String(process.env.EXPERIAN_API_BASE_URL).trim()) {
    const url = String(process.env.EXPERIAN_API_BASE_URL).trim().replace(/\/+$/, "");
    if (/sandbox-us-api\.experian\.com/i.test(url)) {
      throw new Error(
        "US Experian host detected. Use India hosts only (sandbox-in-api / uat-in-api / in-api)."
      );
    }
    return url;
  }

  const env = resolveExperianEnv();
  return String(EXPERIAN_INDIA_BASE_URLS[env] || EXPERIAN_INDIA_BASE_URLS.sandbox).replace(
    /\/+$/,
    ""
  );
}

function getExperianCreditCheckEndpointPath() {
  const path = String(process.env.EXPERIAN_CREDIT_CHECK_ENDPOINT || "").trim();
  return path;
}

function getExperianCreditCheckUrl() {
  const path = getExperianCreditCheckEndpointPath();
  if (!path) {
    const err = new Error(
      "EXPERIAN_CREDIT_CHECK_ENDPOINT is not configured. Set the official Experian India credit-check path from your entitlement docs."
    );
    err.code = "EXPERIAN_ENDPOINT_NOT_CONFIGURED";
    throw err;
  }
  if (/^https?:\/\//i.test(path)) return path;
  const base = getExperianBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function getExperianOAuthTokenUrl() {
  return `${getExperianBaseUrl()}/oauth2/v1/token`;
}

function assertExperianCredentialsConfigured() {
  const missing = [];
  if (!process.env.EXPERIAN_USERNAME) missing.push("EXPERIAN_USERNAME");
  if (!process.env.EXPERIAN_PASSWORD) missing.push("EXPERIAN_PASSWORD");
  if (!process.env.EXPERIAN_CLIENT_ID) missing.push("EXPERIAN_CLIENT_ID");
  if (!process.env.EXPERIAN_CLIENT_SECRET) missing.push("EXPERIAN_CLIENT_SECRET");
  if (missing.length) {
    const err = new Error(`Experian credentials not configured: ${missing.join(", ")}`);
    err.code = "EXPERIAN_CREDENTIALS_MISSING";
    throw err;
  }
}

function isExperianLiveMode() {
  const mode = String(process.env.CREDIT_CHECK_MODE || "sandbox").toLowerCase();
  return mode === "live" || mode === "production" || mode === "uat" || mode === "experian_live";
}

module.exports = {
  EXPERIAN_INDIA_BASE_URLS,
  resolveExperianEnv,
  getExperianBaseUrl,
  getExperianCreditCheckEndpointPath,
  getExperianCreditCheckUrl,
  getExperianOAuthTokenUrl,
  assertExperianCredentialsConfigured,
  isExperianLiveMode,
};
