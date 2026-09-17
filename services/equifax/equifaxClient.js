/**
 * Equifax HTTP client — enrollment vs delivery Bearer tokens.
 */

const crypto = require("crypto");
const {
  getEquifaxAuthHeaders,
  invalidateEquifaxAccessToken,
} = require("./equifaxAuth");
const {
  assertEnvironmentHost,
  getEquifaxBaseUrl,
  getTimeoutMs,
  resolveEquifaxEnv,
  joinUrl,
} = require("./equifaxConfig");
const { mapEquifaxError } = require("./equifaxError");

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch (_e) {
    return "[invalid-url]";
  }
}

/**
 * @param {object} opts
 * @param {'enrollment'|'delivery'} opts.tokenKind
 */
async function equifaxRequest({
  method = "GET",
  path,
  url,
  body,
  query,
  headers: extraHeaders,
  operation = "unknown",
  tokenKind = "delivery",
  retryOn401 = true,
}) {
  assertEnvironmentHost();
  const correlationId = crypto.randomBytes(8).toString("hex");
  const started = Date.now();

  let finalUrl = url || joinUrl(getEquifaxBaseUrl(), path);
  if (query && typeof query === "object") {
    const u = new URL(finalUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") u.searchParams.set(k, String(v));
    }
    finalUrl = u.toString();
  }

  try {
    const baseHost = new URL(getEquifaxBaseUrl()).host;
    if (new URL(finalUrl).host !== baseHost) {
      const err = new Error("Refusing Equifax call outside configured environment base URL");
      err.code = "EQUIFAX_ENV_MISMATCH";
      err.status = 500;
      throw err;
    }
  } catch (e) {
    if (e.code === "EQUIFAX_ENV_MISMATCH") throw e;
  }

  async function doFetch(headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    try {
      const res = await fetch(finalUrl, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
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

  let headers = await getEquifaxAuthHeaders(tokenKind, extraHeaders || {});
  let result = await doFetch(headers);

  if (result.res.status === 401 && retryOn401) {
    invalidateEquifaxAccessToken(tokenKind);
    headers = await getEquifaxAuthHeaders(tokenKind, extraHeaders || {});
    result = await doFetch(headers);
  }

  const durationMs = Date.now() - started;
  console.log("[EQUIFAX]", {
    correlationId,
    environment: resolveEquifaxEnv(),
    operation,
    tokenKind,
    method,
    url: redactUrl(finalUrl),
    status: result.res.status,
    durationMs,
  });

  if (!result.res.ok) {
    const err = new Error(`Equifax ${operation} failed`);
    err.status = result.res.status;
    err.details = (result.text || "").slice(0, 400);
    err.correlationId = correlationId;
    err.diagnostic = {
      environment: resolveEquifaxEnv(),
      baseUrl: getEquifaxBaseUrl(),
      method,
      path: redactUrl(finalUrl),
      httpStatus: result.res.status,
      correlationId,
      tokenKind,
    };
    const mapped = mapEquifaxError(err);
    err.code = mapped.code;
    throw err;
  }

  return {
    data: result.json != null ? result.json : result.text,
    status: result.res.status,
    correlationId,
    durationMs,
  };
}

module.exports = { equifaxRequest };
