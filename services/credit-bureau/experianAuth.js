/**
 * Experian India OAuth2 token management (server-side only).
 * Tokens are cached in memory — never sent to the React frontend, never logged.
 */

const {
  getExperianOAuthTokenUrl,
  assertExperianCredentialsConfigured,
  resolveExperianEnv,
} = require("./experianConfig");

/** In-memory cache (process-local). Prefer Redis in multi-instance deployments. */
const tokenCache = {
  accessToken: null,
  refreshToken: null,
  tokenType: "Bearer",
  expiresAt: 0,
  issuedAt: 0,
};

const SAFETY_SKEW_MS = Number(process.env.EXPERIAN_TOKEN_SKEW_MS || 60_000); // 60s early expiry

function nowMs() {
  return Date.now();
}

function clearExperianTokenCache() {
  tokenCache.accessToken = null;
  tokenCache.refreshToken = null;
  tokenCache.tokenType = "Bearer";
  tokenCache.expiresAt = 0;
  tokenCache.issuedAt = 0;
}

function getCachedTokenSnapshot() {
  return {
    hasAccessToken: Boolean(tokenCache.accessToken),
    hasRefreshToken: Boolean(tokenCache.refreshToken),
    tokenType: tokenCache.tokenType,
    expiresAt: tokenCache.expiresAt,
    issuedAt: tokenCache.issuedAt,
    isValid: Boolean(tokenCache.accessToken && tokenCache.expiresAt > nowMs() + SAFETY_SKEW_MS),
  };
}

function cacheTokenResponse(data) {
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) {
    const err = new Error("Experian OAuth response missing access_token");
    err.code = "EXPERIAN_OAUTH_INVALID_RESPONSE";
    throw err;
  }

  const expiresInSec = Number(data.expires_in || data.expiresIn || 1800);
  const issuedAtRaw = data.issued_at || data.issuedAt;
  const issuedAt = issuedAtRaw != null ? Number(issuedAtRaw) : nowMs();
  // issued_at is milliseconds per Experian docs; expires_in is seconds.
  const expiresAt = issuedAt + expiresInSec * 1000 - SAFETY_SKEW_MS;

  tokenCache.accessToken = accessToken;
  tokenCache.refreshToken = data.refresh_token || data.refreshToken || tokenCache.refreshToken;
  tokenCache.tokenType = data.token_type || data.tokenType || "Bearer";
  tokenCache.issuedAt = issuedAt;
  tokenCache.expiresAt = expiresAt;

  return {
    accessToken: tokenCache.accessToken,
    tokenType: tokenCache.tokenType,
    expiresAt: tokenCache.expiresAt,
  };
}

async function parseOAuthError(res) {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (_e) {
    bodyText = "";
  }
  const err = new Error(`Experian OAuth HTTP ${res.status}`);
  err.status = res.status;
  err.code =
    res.status === 401 || res.status === 403
      ? "EXPERIAN_OAUTH_UNAUTHORIZED"
      : res.status === 429
        ? "EXPERIAN_OAUTH_RATE_LIMITED"
        : "EXPERIAN_OAUTH_FAILED";
  // Never attach secrets; keep truncated non-sensitive hint only.
  err.details = bodyText ? bodyText.slice(0, 200).replace(/"(access|refresh)_token"\s*:\s*"[^"]*"/gi, '"$1_token":"[REDACTED]"') : undefined;
  return err;
}

/**
 * Password grant — Experian India portal username/password + client credentials.
 */
async function getExperianAccessToken() {
  assertExperianCredentialsConfigured();
  const url = getExperianOAuthTokenUrl();
  const started = nowMs();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Grant_type: "password",
    },
    body: JSON.stringify({
      username: process.env.EXPERIAN_USERNAME,
      password: process.env.EXPERIAN_PASSWORD,
      client_id: process.env.EXPERIAN_CLIENT_ID,
      client_secret: process.env.EXPERIAN_CLIENT_SECRET,
    }),
  });

  const durationMs = nowMs() - started;
  console.log(
    `[EXPERIAN-OAUTH] password grant env=${resolveExperianEnv()} status=${res.status} durationMs=${durationMs}`
  );

  if (!res.ok) {
    throw await parseOAuthError(res);
  }

  const data = await res.json();
  return cacheTokenResponse(data);
}

/**
 * Refresh grant — configurable because India docs may vary.
 * Set EXPERIAN_REFRESH_ENABLED=true to use refresh_token flow.
 */
async function refreshExperianAccessToken() {
  if (String(process.env.EXPERIAN_REFRESH_ENABLED || "true").toLowerCase() === "false") {
    clearExperianTokenCache();
    return getExperianAccessToken();
  }

  if (!tokenCache.refreshToken) {
    return getExperianAccessToken();
  }

  assertExperianCredentialsConfigured();
  const url = getExperianOAuthTokenUrl();
  const started = nowMs();

  const body = {
    grant_type: "refresh_token",
    refresh_token: tokenCache.refreshToken,
    client_id: process.env.EXPERIAN_CLIENT_ID,
    client_secret: process.env.EXPERIAN_CLIENT_SECRET,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Grant_type: "refresh_token",
    },
    body: JSON.stringify(body),
  });

  const durationMs = nowMs() - started;
  console.log(
    `[EXPERIAN-OAUTH] refresh grant env=${resolveExperianEnv()} status=${res.status} durationMs=${durationMs}`
  );

  if (!res.ok) {
    clearExperianTokenCache();
    // Fall back to password grant once.
    return getExperianAccessToken();
  }

  const data = await res.json();
  return cacheTokenResponse(data);
}

/**
 * Returns a valid access token string. Uses cache → refresh → password grant.
 */
async function getValidExperianToken() {
  if (tokenCache.accessToken && tokenCache.expiresAt > nowMs() + SAFETY_SKEW_MS) {
    return {
      accessToken: tokenCache.accessToken,
      tokenType: tokenCache.tokenType || "Bearer",
      expiresAt: tokenCache.expiresAt,
      fromCache: true,
    };
  }

  if (tokenCache.refreshToken) {
    try {
      const refreshed = await refreshExperianAccessToken();
      return { ...refreshed, fromCache: false };
    } catch (error) {
      console.warn("[EXPERIAN-OAUTH] refresh failed, requesting new password token");
      clearExperianTokenCache();
    }
  }

  const fresh = await getExperianAccessToken();
  return { ...fresh, fromCache: false };
}

function invalidateExperianToken() {
  clearExperianTokenCache();
}

/** Test helper — inject cache state without network. */
function __setTokenCacheForTests(state = {}) {
  tokenCache.accessToken = state.accessToken || null;
  tokenCache.refreshToken = state.refreshToken || null;
  tokenCache.tokenType = state.tokenType || "Bearer";
  tokenCache.expiresAt = state.expiresAt || 0;
  tokenCache.issuedAt = state.issuedAt || 0;
}

module.exports = {
  getExperianAccessToken,
  refreshExperianAccessToken,
  getValidExperianToken,
  invalidateExperianToken,
  clearExperianTokenCache,
  getCachedTokenSnapshot,
  cacheTokenResponse,
  __setTokenCacheForTests,
};
