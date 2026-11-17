const crypto = require("crypto");

/** RFC 7636 unreserved charset for code_verifier. */
const VERIFIER_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/**
 * Generate a high-entropy code_verifier (43–128 chars).
 */
function generateCodeVerifier(length = 64) {
  const size = Math.min(Math.max(Number(length) || 64, 43), 128);
  const bytes = crypto.randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) {
    out += VERIFIER_CHARSET[bytes[i] % VERIFIER_CHARSET.length];
  }
  return out;
}

/** Base64URL encode without padding. */
function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** S256 code_challenge = BASE64URL(SHA256(verifier)). */
function generateCodeChallengeS256(codeVerifier) {
  const hash = crypto.createHash("sha256").update(String(codeVerifier), "utf8").digest();
  return base64UrlEncode(hash);
}

function generateOAuthState() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateNonce() {
  return base64UrlEncode(crypto.randomBytes(24));
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallengeS256,
  generateOAuthState,
  generateNonce,
  base64UrlEncode,
};
