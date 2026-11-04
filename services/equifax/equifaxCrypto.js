/**
 * Safe logging / form helpers for Equifax B2B2C.
 * Never log keys, assertions, tokens, or PII.
 */

const SENSITIVE_KEYS =
  /authorization|access_token|client_assertion|assertion|private|symmetric|password|ssn|pan|dob|secret|api_key/i;

function redactObject(obj, depth = 0) {
  if (obj == null || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = "[REDACTED]";
    else if (typeof v === "object") out[k] = redactObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

function toFormBody(fields) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  return params.toString();
}

function extractAssertion(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_e) {
      return payload.trim() || null;
    }
  }
  return (
    payload.client_assertion ||
    payload.assertion ||
    payload.jwt ||
    payload.claim ||
    payload.jwtClaim ||
    payload.data?.assertion ||
    payload.data?.client_assertion ||
    null
  );
}

function extractAccessToken(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.access_token || payload.accessToken || payload.data?.access_token || null;
}

module.exports = {
  redactObject,
  toFormBody,
  extractAssertion,
  extractAccessToken,
};
