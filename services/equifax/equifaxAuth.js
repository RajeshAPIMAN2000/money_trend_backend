/**
 * Equifax B2B2C dual-token auth:
 * 1) POST .../oauth/generate-jwt-claim
 * 2) POST .../oauth/token (grant_type=jwt-bearer)
 *
 * Separate caches for enrollment_token and delivery_token.
 * MoneyTrend JWT is never used here.
 */

const {
  getEquifaxBaseUrl,
  getAuthPaths,
  getEnrollmentAuthParams,
  getDeliveryAuthParams,
  getCryptoMaterial,
  getTimeoutMs,
  getTokenSkewMs,
  joinUrl,
  validateEquifaxReady,
  resolveEquifaxEnv,
} = require("./equifaxConfig");
const { toFormBody, extractAssertion, extractAccessToken } = require("./equifaxCrypto");

const caches = {
  enrollment: { accessToken: null, tokenType: "Bearer", expiresAt: 0, issuedAt: 0, env: null, inflight: null },
  delivery: { accessToken: null, tokenType: "Bearer", expiresAt: 0, issuedAt: 0, env: null, inflight: null },
};

function nowMs() {
  return Date.now();
}

function clearCachedEquifaxCredential(kind) {
  if (kind === "enrollment" || kind === "delivery") {
    const c = caches[kind];
    c.accessToken = null;
    c.expiresAt = 0;
    c.issuedAt = 0;
    c.env = null;
    c.inflight = null;
    return;
  }
  clearCachedEquifaxCredential("enrollment");
  clearCachedEquifaxCredential("delivery");
}

function getEquifaxCredentialSnapshot(kind = "enrollment") {
  const c = caches[kind] || caches.enrollment;
  const skew = getTokenSkewMs();
  return {
    kind,
    hasCredential: Boolean(c.accessToken),
    tokenType: c.tokenType,
    expiresAt: c.expiresAt || null,
    issuedAt: c.issuedAt || null,
    env: c.env || resolveEquifaxEnv(),
    isValid: Boolean(c.accessToken && c.expiresAt > nowMs() + skew && c.env === resolveEquifaxEnv()),
  };
}

async function postForm(url, fields) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormBody(fields),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_e) {
      json = null;
    }
    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function generateJwtClaim(kind) {
  validateEquifaxReady(kind);
  const crypto = getCryptoMaterial();
  const params = kind === "delivery" ? getDeliveryAuthParams() : getEnrollmentAuthParams();
  const paths = getAuthPaths();
  const url = joinUrl(getEquifaxBaseUrl(), paths.generateJwtClaim);

  console.log("[EQUIFAX][AUTH] generate-jwt-claim", {
    env: resolveEquifaxEnv(),
    kind,
    scope: params.scope,
    path: paths.generateJwtClaim,
  });

  const { res, text, json } = await postForm(url, {
    symmetricKey: crypto.symmetricKey,
    base64PrivateKey: crypto.base64PrivateKey,
    scope: params.scope,
    issuer: params.issuer,
    subject: params.subject,
    expiration: params.expiration,
  });

  if (!res.ok) {
    const err = new Error("Equifax JWT claim generation failed");
    err.status = res.status;
    err.code = "EQUIFAX_AUTH_FAILED";
    err.details = String(text || "").slice(0, 200);
    throw err;
  }

  const assertion = extractAssertion(json != null ? json : text);
  if (!assertion) {
    const err = new Error("Equifax generate-jwt-claim response missing assertion");
    err.code = "EQUIFAX_AUTH_INVALID_RESPONSE";
    err.status = 502;
    throw err;
  }
  return assertion;
}

async function exchangeJwtBearer(kind, assertion) {
  const params = kind === "delivery" ? getDeliveryAuthParams() : getEnrollmentAuthParams();
  const paths = getAuthPaths();
  const url = joinUrl(getEquifaxBaseUrl(), paths.token);

  console.log("[EQUIFAX][AUTH] oauth/token", {
    env: resolveEquifaxEnv(),
    kind,
    scope: params.scope,
    grant_type: params.grantType,
    path: paths.token,
  });

  const { res, text, json } = await postForm(url, {
    scope: params.scope,
    grant_type: params.grantType,
    api_key: params.apiKey,
    client_assertion: assertion,
  });

  if (!res.ok) {
    const err = new Error("Equifax authentication failed");
    err.status = res.status;
    err.code =
      res.status === 401 || res.status === 403 ? "EQUIFAX_AUTH_FAILED" : "EQUIFAX_AUTH_FAILED";
    err.details = String(text || "")
      .slice(0, 240)
      .replace(/"(access_token|client_assertion|assertion)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"');
    throw err;
  }

  const accessToken = extractAccessToken(json);
  if (!accessToken) {
    const err = new Error("Equifax token response missing access_token");
    err.code = "EQUIFAX_AUTH_INVALID_RESPONSE";
    err.status = 502;
    throw err;
  }

  const expiresInSec = Number(json.expires_in || json.expiresIn || params.expiration || 59);
  const c = caches[kind];
  c.accessToken = accessToken;
  c.tokenType = json.token_type || json.tokenType || "Bearer";
  c.issuedAt = nowMs();
  c.expiresAt = c.issuedAt + expiresInSec * 1000 - getTokenSkewMs();
  c.env = resolveEquifaxEnv();
  return {
    accessToken: c.accessToken,
    tokenType: c.tokenType,
    expiresAt: c.expiresAt,
    kind,
  };
}

async function requestToken(kind) {
  const assertion = await generateJwtClaim(kind);
  return exchangeJwtBearer(kind, assertion);
}

async function getEquifaxAccessToken(kind = "enrollment", { forceRefresh = false } = {}) {
  if (kind !== "enrollment" && kind !== "delivery") {
    const err = new Error("Equifax token kind must be enrollment or delivery");
    err.code = "EQUIFAX_VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  const c = caches[kind];
  const skew = getTokenSkewMs();
  if (
    !forceRefresh &&
    c.accessToken &&
    c.expiresAt > nowMs() + skew &&
    c.env === resolveEquifaxEnv()
  ) {
    return {
      accessToken: c.accessToken,
      tokenType: c.tokenType,
      expiresAt: c.expiresAt,
      kind,
      cached: true,
    };
  }

  // Stampede protection
  if (c.inflight) return c.inflight.then((t) => ({ ...t, cached: false }));

  c.inflight = requestToken(kind)
    .then((t) => t)
    .finally(() => {
      c.inflight = null;
    });

  const token = await c.inflight;
  return { ...token, cached: false };
}

async function getEquifaxCredential(kind = "enrollment", options = {}) {
  return getEquifaxAccessToken(kind, options);
}

async function getEquifaxAuthHeaders(kind = "enrollment", extra = {}) {
  const { accessToken, tokenType } = await getEquifaxAccessToken(kind);
  return {
    Authorization: `${tokenType || "Bearer"} ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra,
  };
}

function invalidateEquifaxAccessToken(kind) {
  clearCachedEquifaxCredential(kind);
}

module.exports = {
  getEquifaxAccessToken,
  getEquifaxCredential,
  getEquifaxAuthHeaders,
  clearCachedEquifaxCredential,
  invalidateEquifaxAccessToken,
  getEquifaxCredentialSnapshot,
  // exposed for tests
  _caches: caches,
  generateJwtClaim,
  exchangeJwtBearer,
};
