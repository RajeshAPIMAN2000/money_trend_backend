const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  generateCodeVerifier,
  generateCodeChallengeS256,
  generateOAuthState,
  generateNonce,
  base64UrlEncode,
} = require("../services/digilocker/pkce");

test("generateCodeVerifier length and charset", () => {
  const v = generateCodeVerifier(64);
  assert.equal(v.length, 64);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
});

test("generateCodeVerifier clamps to RFC 7636 bounds", () => {
  assert.equal(generateCodeVerifier(10).length, 43);
  assert.equal(generateCodeVerifier(200).length, 128);
});

test("S256 challenge is base64url SHA-256 of verifier", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expected = base64UrlEncode(
    crypto.createHash("sha256").update(verifier, "utf8").digest()
  );
  assert.equal(generateCodeChallengeS256(verifier), expected);
  assert.doesNotMatch(expected, /[+/=]/);
});

test("each start generates unique verifier and state", () => {
  const a = generateCodeVerifier(64);
  const b = generateCodeVerifier(64);
  const s1 = generateOAuthState();
  const s2 = generateOAuthState();
  assert.notEqual(a, b);
  assert.notEqual(s1, s2);
  assert.ok(s1.length >= 32);
  assert.ok(generateNonce().length >= 16);
});

test("does not reuse sample PKCE values from docs", () => {
  const sampleVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  for (let i = 0; i < 20; i++) {
    assert.notEqual(generateCodeVerifier(43), sampleVerifier);
  }
});
