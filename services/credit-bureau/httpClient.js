const DEFAULT_TIMEOUT_MS = Number(process.env.BUREAU_HTTP_TIMEOUT_MS || 15000);
const MAX_RETRIES = 2;

function createBureauHttpError(status, bodySnippet) {
  const err = new Error(`Bureau API HTTP ${status}`);
  err.status = status;
  err.bodySnippet = bodySnippet ? String(bodySnippet).slice(0, 300) : undefined;

  if (status === 400) err.code = "BUREAU_BAD_REQUEST";
  else if (status === 401) err.code = "BUREAU_UNAUTHORIZED";
  else if (status === 403) err.code = "BUREAU_FORBIDDEN";
  else if (status === 404) err.code = "BUREAU_NOT_FOUND";
  else if (status === 409) err.code = "BUREAU_CONFLICT";
  else if (status === 422) err.code = "BUREAU_UNPROCESSABLE";
  else if (status === 429) err.code = "BUREAU_RATE_LIMITED";
  else if (status === 502) err.code = "BUREAU_BAD_GATEWAY";
  else if (status === 503) err.code = "BUREAU_UNAVAILABLE";
  else if (status === 504) err.code = "BUREAU_TIMEOUT_GATEWAY";
  else if (status >= 500) err.code = "BUREAU_SERVER_ERROR";
  else err.code = "BUREAU_HTTP_ERROR";

  return err;
}

async function readResponseBody(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      return await res.json();
    } catch (_e) {
      return { rawText: await res.text().catch(() => "") };
    }
  }
  const text = await res.text();
  return { rawXml: text };
}

/**
 * @param {string} url
 * @param {object} options - fetch options
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries] - retries for timeouts only
 * @param {() => Promise<{headers?: object}>} [opts.onUnauthorized] - called once on 401; return new headers to merge & retry once
 */
async function fetchWithRetry(url, options = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : MAX_RETRIES;
  let lastError;
  let authRetried = false;
  let currentOptions = { ...options };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...currentOptions, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 401 && typeof opts.onUnauthorized === "function" && !authRetried) {
        authRetried = true;
        const patch = (await opts.onUnauthorized()) || {};
        currentOptions = {
          ...currentOptions,
          headers: {
            ...(currentOptions.headers || {}),
            ...(patch.headers || {}),
          },
        };
        attempt -= 1; // allow one dedicated auth retry outside timeout budget
        continue;
      }

      if (!res.ok) {
        let snippet = "";
        try {
          snippet = await res.text();
        } catch (_e) {
          snippet = "";
        }
        throw createBureauHttpError(res.status, snippet);
      }

      return await readResponseBody(res);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const isTimeout =
        error.name === "AbortError" || String(error.message || "").includes("timeout");
      if (attempt < maxRetries && isTimeout) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

module.exports = {
  fetchWithRetry,
  createBureauHttpError,
  MAX_RETRIES,
  TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
};
