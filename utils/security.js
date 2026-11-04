const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const secret =
    process.env.PII_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    "dev_pii_encryption_key_min_32_chars!!";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/** Encrypt sensitive PII at rest (AES-256-GCM). */
function encryptPii(plainText) {
  if (plainText == null || plainText === "") return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPii(payload) {
  if (payload == null || payload === "") return null;
  if (!String(payload).startsWith("enc:")) return String(payload);
  try {
    const [, ivHex, tagHex, dataHex] = String(payload).split(":");
    const decipher = crypto.createDecipheriv(ALGO, getEncryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (_e) {
    return null;
  }
}

function maskAadhaar(aadhaar) {
  const digits = String(aadhaar || "").replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

function maskPan(pan) {
  const value = String(pan || "").toUpperCase();
  if (value.length !== 10) return null;
  return `${value.slice(0, 3)}XXXX${value.slice(-3)}`;
}

function maskEmail(email) {
  const value = String(email || "");
  const at = value.indexOf("@");
  if (at < 1) return value || null;
  const name = value.slice(0, at);
  const domain = value.slice(at);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 1))}${domain}`;
}

function maskMobile(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

module.exports = {
  encryptPii,
  decryptPii,
  maskAadhaar,
  maskPan,
  maskEmail,
  maskMobile,
};
