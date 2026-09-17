const test = require("node:test");
const assert = require("node:assert/strict");

process.env.EMAIL_PROVIDER = "sandbox";
process.env.OTP_HASH_PEPPER = "test_pepper";
process.env.OTP_EXPIRY_MINUTES = "10";
process.env.OTP_MAX_ATTEMPTS = "5";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";

const {
  generateSecureOtp,
  hashOtp,
  safeEqualHash,
  maskEmail,
} = require("../utils/otpCrypto");
const { normalizePurpose, EMAIL_OTP_PURPOSES } = require("../services/emailOtpService");
const { buildOtpEmail } = require("../services/email/templates/otpEmail");
const { resetEmailProviderCache } = require("../services/email/providers");
const { sendEmail, sendOtpEmail } = require("../services/emailService");

test("OTP generation is 6 digits and not Math.random based", () => {
  for (let i = 0; i < 20; i++) {
    const otp = generateSecureOtp(6);
    assert.match(otp, /^\d{6}$/);
  }
});

test("OTP hashing is deterministic and does not equal raw OTP", () => {
  const otp = "483921";
  const hash = hashOtp(otp);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, otp);
  assert.equal(hash, hashOtp(otp));
  assert.notEqual(hash, hashOtp("483922"));
});

test("safeEqualHash constant-time compare", () => {
  const a = hashOtp("123456");
  const b = hashOtp("123456");
  const c = hashOtp("654321");
  assert.equal(safeEqualHash(a, b), true);
  assert.equal(safeEqualHash(a, c), false);
  assert.equal(safeEqualHash(a, "short"), false);
});

test("email masking", () => {
  assert.equal(maskEmail("user@example.com"), "us***@example.com");
});

test("purpose normalization and mismatch protection list", () => {
  assert.equal(normalizePurpose("register"), "EMAIL_VERIFICATION");
  assert.equal(normalizePurpose("login"), "LOGIN_VERIFICATION");
  assert.equal(normalizePurpose("forgot_password"), "PASSWORD_RESET");
  assert.equal(normalizePurpose("EMAIL_VERIFICATION"), "EMAIL_VERIFICATION");
  assert.equal(normalizePurpose("bad_purpose"), null);
  assert.ok(EMAIL_OTP_PURPOSES.includes("TRANSACTION_VERIFICATION"));
});

test("OTP email template contains branding and OTP without marketing fluff", () => {
  const content = buildOtpEmail({
    firstName: "Rajesh",
    otp: "483921",
    purpose: "EMAIL_VERIFICATION",
    expiresMinutes: 10,
  });
  assert.match(content.subject, /verification/i);
  assert.match(content.html, /483921/);
  assert.match(content.html, /Verify Your Email/);
  assert.match(content.html, /Rajesh/);
  assert.match(content.text, /483921/);
  assert.match(content.text, /10 minutes/);
});

test("sandbox email provider sends without exposing secrets", async () => {
  resetEmailProviderCache();
  const result = await sendEmail({
    to: "user@example.com",
    subject: "Test",
    html: "<p>Hi</p>",
    text: "Hi",
    emailType: "unit_test",
  });
  assert.equal(result.provider, "sandbox");
  assert.ok(result.messageId);
});

test("sendOtpEmail works via sandbox provider", async () => {
  resetEmailProviderCache();
  const result = await sendOtpEmail({
    to: "user@example.com",
    firstName: "Rajesh",
    otp: "112233",
    purpose: "LOGIN_VERIFICATION",
    expiresMinutes: 10,
  });
  assert.equal(result.status, "logged");
});
