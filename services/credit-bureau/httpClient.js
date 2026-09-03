const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const err = new Error(`Bureau API HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("json")) return await res.json();
      const text = await res.text();
      return { rawXml: text };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const isTimeout =
        error.name === "AbortError" || String(error.message).includes("timeout");
      if (attempt < MAX_RETRIES && isTimeout) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

module.exports = { fetchWithRetry, MAX_RETRIES, TIMEOUT_MS };
