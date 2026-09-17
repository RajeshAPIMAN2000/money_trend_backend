/**
 * Equifax Consumer Engagement Suite (B2B2C) configuration.
 * Enrollment auth and Delivery auth are separate token scopes.
 */

const ENV_HOSTS = {
  sandbox: "api.sandbox.equifax.com",
  test: "api.uat.equifax.com",
  uat: "api.uat.equifax.com",
  live: "api.equifax.com",
  production: "api.equifax.com",
};

function resolveEquifaxEnv() {
  const raw = String(process.env.EQUIFAX_ENV || "sandbox").trim().toLowerCase();
  if (raw === "live" || raw === "prod" || raw === "production") return "live";
  if (raw === "test" || raw === "uat" || raw === "staging") return "test";
  return "sandbox";
}

function isEquifaxEnabled() {
  return String(process.env.EQUIFAX_ENABLED || "true").toLowerCase() !== "false";
}

function getEquifaxBaseUrl() {
  if (String(process.env.EQUIFAX_BASE_URL || "").trim()) {
    return String(process.env.EQUIFAX_BASE_URL).trim().replace(/\/+$/, "");
  }
  const env = resolveEquifaxEnv();
  if (env === "live") return "https://api.equifax.com";
  if (env === "test") {
    return String(process.env.EQUIFAX_UAT_BASE_URL || "https://api.uat.equifax.com").replace(/\/+$/, "");
  }
  return String(process.env.EQUIFAX_SANDBOX_BASE_URL || "https://api.sandbox.equifax.com").replace(
    /\/+$/,
    ""
  );
}

function getTimeoutMs() {
  return Number(process.env.EQUIFAX_TIMEOUT_MS || 30000);
}

function getTokenSkewMs() {
  const sec = Number(process.env.EQUIFAX_TOKEN_SKEW_SECONDS || 60);
  return (Number.isFinite(sec) ? sec : 60) * 1000;
}

function getAuthPaths() {
  return {
    generateJwtClaim:
      process.env.EQUIFAX_GENERATE_JWT_PATH ||
      "/personal/consumer-data-suite/oauth/generate-jwt-claim",
    token: process.env.EQUIFAX_OAUTH_TOKEN_PATH || "/personal/consumer-data-suite/oauth/token",
  };
}

/**
 * Sandbox fixtures from Equifax collections — only used when EQUIFAX_ENV=sandbox
 * and env overrides are empty. Never used for test/live.
 */
function getEnrollmentAuthParams() {
  const env = resolveEquifaxEnv();
  const isSandbox = env === "sandbox";
  return {
    scope: "enrollment",
    issuer: process.env.EQUIFAX_JWT_ISSUER || "EFX",
    subject:
      process.env.EQUIFAX_ENROLLMENT_SUBJECT ||
      (isSandbox ? "mock_enrollment:mock_enrollment" : ""),
    apiKey:
      process.env.EQUIFAX_ENROLLMENT_API_KEY || (isSandbox ? "mock_enrollment" : ""),
    expiration: String(process.env.EQUIFAX_JWT_EXPIRATION || "59"),
    grantType: "jwt-bearer",
  };
}

function getDeliveryAuthParams() {
  const env = resolveEquifaxEnv();
  const isSandbox = env === "sandbox";
  return {
    scope: "delivery",
    issuer: process.env.EQUIFAX_JWT_ISSUER || "EFX",
    subject:
      process.env.EQUIFAX_DELIVERY_SUBJECT ||
      (isSandbox ? "mock_delivery:mock_delivery" : ""),
    apiKey: process.env.EQUIFAX_DELIVERY_API_KEY || (isSandbox ? "mock_delivery" : ""),
    expiration: String(process.env.EQUIFAX_JWT_EXPIRATION || "59"),
    grantType: "jwt-bearer",
  };
}

function getCryptoMaterial() {
  return {
    symmetricKey: String(process.env.EQUIFAX_SYMMETRIC_KEY || "").trim(),
    base64PrivateKey: String(process.env.EQUIFAX_BASE64_PRIVATE_KEY || "").trim(),
  };
}

/**
 * Local/dev mock when Equifax jwt keys are not configured.
 * Enabled when:
 * - EQUIFAX_MOCK=true, OR
 * - EQUIFAX_ENV=sandbox AND keys missing (default for local testing)
 * Never auto-mocks test/live.
 */
function isEquifaxMockMode() {
  if (String(process.env.EQUIFAX_MOCK || "").toLowerCase() === "true") return true;
  if (String(process.env.EQUIFAX_MOCK || "").toLowerCase() === "false") return false;
  if (resolveEquifaxEnv() !== "sandbox") return false;
  const crypto = getCryptoMaterial();
  return !crypto.symmetricKey || !crypto.base64PrivateKey;
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  return `${b}${p.startsWith("/") ? p : `/${p}`}`;
}

function assertEnvironmentHost() {
  const env = resolveEquifaxEnv();
  const base = getEquifaxBaseUrl();
  let host;
  try {
    host = new URL(base).host;
  } catch (_e) {
    const err = new Error("Invalid EQUIFAX_BASE_URL");
    err.code = "EQUIFAX_ENV_MISMATCH";
    err.status = 500;
    throw err;
  }
  const expected = ENV_HOSTS[env];
  // Allow explicit EQUIFAX_BASE_URL override but warn via mismatch if host wrong
  if (expected && host !== expected && !process.env.EQUIFAX_BASE_URL) {
    const err = new Error(`Equifax env ${env} expects host ${expected}, got ${host}`);
    err.code = "EQUIFAX_ENV_MISMATCH";
    err.status = 500;
    throw err;
  }
  return { env, base, host };
}

function getConfigSnapshot() {
  const { env, base, host } = (() => {
    try {
      return assertEnvironmentHost();
    } catch (_e) {
      return { env: resolveEquifaxEnv(), base: getEquifaxBaseUrl(), host: null };
    }
  })();
  const crypto = getCryptoMaterial();
  const enroll = getEnrollmentAuthParams();
  const delivery = getDeliveryAuthParams();
  return {
    provider: "Equifax",
    applicationType: "B2B2C",
    enabled: isEquifaxEnabled(),
    environment: env,
    baseUrl: base,
    host,
    mockMode: isEquifaxMockMode(),
    auth: {
      mode: isEquifaxMockMode() ? "mock_sandbox" : "jwt-bearer",
      enrollmentApiKeyConfigured: Boolean(enroll.apiKey),
      deliveryApiKeyConfigured: Boolean(delivery.apiKey),
      enrollmentSubjectConfigured: Boolean(enroll.subject),
      deliverySubjectConfigured: Boolean(delivery.subject),
      symmetricKeyConfigured: Boolean(crypto.symmetricKey),
      privateKeyConfigured: Boolean(crypto.base64PrivateKey),
      clientIdConfigured: Boolean(String(process.env.EQUIFAX_CLIENT_ID || "").trim()),
      clientSecretConfigured: Boolean(String(process.env.EQUIFAX_CLIENT_SECRET || "").trim()),
    },
    paths: getAuthPaths(),
  };
}

function validateEquifaxReady(kind = "enrollment") {
  if (!isEquifaxEnabled()) {
    const err = new Error("Equifax integration is disabled (EQUIFAX_ENABLED=false)");
    err.code = "EQUIFAX_DISABLED";
    err.status = 503;
    throw err;
  }
  if (isEquifaxMockMode()) {
    return { mock: true, kind };
  }
  assertEnvironmentHost();
  const crypto = getCryptoMaterial();
  const missing = [];
  if (!crypto.symmetricKey) missing.push("EQUIFAX_SYMMETRIC_KEY");
  if (!crypto.base64PrivateKey) missing.push("EQUIFAX_BASE64_PRIVATE_KEY");

  const params = kind === "delivery" ? getDeliveryAuthParams() : getEnrollmentAuthParams();
  if (!params.apiKey) {
    missing.push(kind === "delivery" ? "EQUIFAX_DELIVERY_API_KEY" : "EQUIFAX_ENROLLMENT_API_KEY");
  }
  if (!params.subject) {
    missing.push(kind === "delivery" ? "EQUIFAX_DELIVERY_SUBJECT" : "EQUIFAX_ENROLLMENT_SUBJECT");
  }

  if (missing.length) {
    const err = new Error(`Equifax configuration incomplete: ${missing.join(", ")}`);
    err.code = "EQUIFAX_CONFIG_INCOMPLETE";
    err.status = 503;
    err.missing = missing;
    throw err;
  }
  return { mock: false, kind };
}

module.exports = {
  resolveEquifaxEnv,
  isEquifaxEnabled,
  isEquifaxMockMode,
  getEquifaxBaseUrl,
  getTimeoutMs,
  getTokenSkewMs,
  getAuthPaths,
  getEnrollmentAuthParams,
  getDeliveryAuthParams,
  getCryptoMaterial,
  joinUrl,
  assertEnvironmentHost,
  getConfigSnapshot,
  validateEquifaxReady,
};
