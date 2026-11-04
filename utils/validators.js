/** SEBI / Mutual Fund common nominee relationships (AMC-aligned). */
const SEBI_NOMINEE_RELATIONSHIPS = [
  "Spouse",
  "Father",
  "Mother",
  "Son",
  "Daughter",
  "Brother",
  "Sister",
  "Grandson",
  "Granddaughter",
  "Father-in-law",
  "Mother-in-law",
  "Son-in-law",
  "Daughter-in-law",
  "Others",
];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isValidPhone(phone) {
  const digits = normalizeMobile(phone);
  return /^[6-9]\d{9}$/.test(digits);
}

/** Normalize Indian mobile to 10 digits (strips +91 / 91 / 0 prefix). */
function normalizeMobile(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

/**
 * Normalize DB / request DOB values to YYYY-MM-DD.
 * mysql2 returns MySQL DATE as a JS Date at local midnight — use local
 * Y/M/D (not UTC) or the calendar day shifts in IST (+05:30).
 */
function toDobIso(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // e.g. "Mon Jun 16 1997 ..." from some drivers
  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime()) && /[a-zA-Z]/.test(s)) {
    const y = asDate.getFullYear();
    const m = String(asDate.getMonth() + 1).padStart(2, "0");
    const d = String(asDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const parsed = parseDob(s);
  return parsed ? parsed.iso : null;
}

function normalizePan(pan) {
  return String(pan || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeAadhaar(aadhaar) {
  return String(aadhaar || "")
    .replace(/\s+/g, "")
    .trim();
}

function isValidPan(pan) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
}

/** Verhoeff check for Aadhaar (basic integrity; not identity proof). */
function isValidAadhaar(aadhaar) {
  const digits = String(aadhaar || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) return false;
  // Reject obviously invalid sequences
  if (/^(\d)\1{11}$/.test(digits)) return false;
  return true;
}

function sanitizeText(value, maxLen = 255) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Accepts YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY
 * Returns { iso: 'YYYY-MM-DD', date: Date } or null
 */
function parseDob(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  let year;
  let month;
  let day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    [year, month, day] = value.split("-").map(Number);
  } else if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(value)) {
    const parts = value.split(/[-/]/);
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
      iso: parsed.toISOString().slice(0, 10),
      date: parsed,
    };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const now = new Date();
  if (date > now) return null;

  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    date,
  };
}

function getAgeYears(dobDate) {
  const today = new Date();
  let age = today.getFullYear() - dobDate.getUTCFullYear();
  const m = today.getMonth() - dobDate.getUTCMonth();
  if (m < 0 || (m === 0 && today.getDate() < dobDate.getUTCDate())) age -= 1;
  return age;
}

function normalizeRelationship(relationship) {
  const raw = sanitizeText(relationship, 100);
  const found = SEBI_NOMINEE_RELATIONSHIPS.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );
  return found || null;
}

module.exports = {
  SEBI_NOMINEE_RELATIONSHIPS,
  isValidEmail,
  isValidPhone,
  normalizeMobile,
  toDobIso,
  normalizePan,
  normalizeAadhaar,
  isValidPan,
  isValidAadhaar,
  sanitizeText,
  parseDob,
  getAgeYears,
  normalizeRelationship,
};
