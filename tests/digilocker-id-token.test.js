const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeJwtPayload,
  validateIdTokenClaims,
} = require("../services/digilocker/digilockerService");

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("decodeJwtPayload reads claims", () => {
  const token = fakeJwt({ aud: "BN6CF9DE38", exp: Math.floor(Date.now() / 1000) + 3600 });
  const payload = decodeJwtPayload(token);
  assert.equal(payload.aud, "BN6CF9DE38");
});

test("validateIdTokenClaims accepts matching aud and nonce", () => {
  const payload = {
    aud: "BN6CF9DE38",
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: "abc123",
  };
  const result = validateIdTokenClaims(payload, { clientId: "BN6CF9DE38", nonce: "abc123" });
  assert.equal(result.ok, true);
  assert.equal(result.signature_verified, false);
});

test("validateIdTokenClaims rejects aud mismatch", () => {
  const result = validateIdTokenClaims(
    { aud: "other", exp: Math.floor(Date.now() / 1000) + 600 },
    { clientId: "BN6CF9DE38", nonce: null }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "aud_mismatch");
});

test("validateIdTokenClaims rejects expired token", () => {
  const result = validateIdTokenClaims(
    { aud: "BN6CF9DE38", exp: Math.floor(Date.now() / 1000) - 3600 },
    { clientId: "BN6CF9DE38", nonce: null }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
});

test("validateIdTokenClaims rejects nonce mismatch", () => {
  const result = validateIdTokenClaims(
    {
      aud: "BN6CF9DE38",
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: "one",
    },
    { clientId: "BN6CF9DE38", nonce: "two" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "nonce_mismatch");
});
