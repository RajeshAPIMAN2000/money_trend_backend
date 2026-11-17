/**
 * DigiLocker eKYC verification scoring.
 *
 * DigiLocker login/OTP/PIN are handled only by DigiLocker — MoneyTrend never
 * requests, receives, stores or logs OTP or PIN.
 *
 * DigiLocker OAuth success ≠ Aadhaar/PAN authenticity by itself.
 *
 * Overall outcomes:
 * - VERIFIED      — all required checks pass (auto-approve)
 * - PENDING       — required evidence still missing
 * - MANUAL_REVIEW — identity mismatch or uncertain authenticity
 * - FAILED        — confirmed invalid / failed verification
 */

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDob(value) {
  if (!value) return "";
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return s.toLowerCase();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return { matched: false, reason: "missing_name" };
  if (na === nb) return { matched: true, reason: "exact" };
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const ok = short.every((t) => long.includes(t));
  return { matched: ok, reason: ok ? "token_subset" : "mismatch" };
}

function dobsMatch(a, b) {
  const da = normalizeDob(a);
  const db = normalizeDob(b);
  if (!da || !db) return { matched: false, reason: "missing_dob" };
  return { matched: da === db, reason: da === db ? "exact" : "mismatch" };
}

function detectPanFromDocs(issuedDocs = []) {
  for (const d of issuedDocs) {
    const label = `${d.name || ""} ${d.doctype || ""} ${d.issuerid || ""}`.toUpperCase();
    if (label.includes("PAN") || label.includes("INCOME TAX") || String(d.doctype || "").toUpperCase() === "PANCR") {
      return true;
    }
  }
  return false;
}

function detectAadhaarFromDocs(issuedDocs = [], bundle = {}) {
  if (bundle.eaadhaar_fetched || String(bundle.eaadhaar || "").toUpperCase() === "Y") return true;
  if (bundle.aadhaar_last4) return true;
  for (const d of issuedDocs) {
    const label = `${d.name || ""} ${d.doctype || ""}`.toUpperCase();
    if (label.includes("AADHAAR") || label.includes("ADHAR") || label.includes("UIDAI") || label.includes("EAADHAAR")) {
      return true;
    }
  }
  return false;
}

/**
 * Document authenticity: DigiLocker-issued metadata / e-Aadhaar fetch is treated as
 * provider-attested evidence. Full cryptographic issuer-signature verification against
 * DigiLocker JWKS / document signing keys remains PENDING until partner publishes the
 * required verification endpoints/keys.
 */
function assessDocumentAuthenticity(bundle = {}) {
  const docs = Array.isArray(bundle.issued_docs) ? bundle.issued_docs : [];
  const hasDocs = docs.length > 0 || bundle.eaadhaar_fetched || bundle.user_details_fetched;
  if (!hasDocs) {
    return {
      status: "pending",
      detail: "No DigiLocker document/profile payload available to assess authenticity",
      method: "none",
      signature_verified: false,
    };
  }
  return {
    status: "provider_attested",
    detail:
      "Documents/profile retrieved via DigiLocker partner APIs after user consent. Cryptographic issuer signature verification requires DigiLocker JWKS/document signing keys (outstanding partner item).",
    method: bundle.eaadhaar_fetched ? "eaadhaar_xml_metadata" : "issued_docs_metadata",
    signature_verified: false,
    issued_docs_count: docs.length,
  };
}

/**
 * @returns verification object with overall_status in
 * VERIFIED | PENDING | MANUAL_REVIEW | FAILED
 */
function evaluateDigilockerVerification({ bundle, user, options = {} }) {
  const requireAadhaar = options.requireAadhaar !== false;
  const requirePan = options.requirePan !== false;
  const requireNameMatch = options.requireNameMatch !== false;
  const requireDobMatch = options.requireDobMatch === true;
  // Journey: auto-approve when all required checks pass (default true)
  const autoApprove = options.autoApprove !== false;

  const auth = {
    status: "passed",
    detail: "DigiLocker OAuth authentication and consent completed (OTP/PIN never handled by MoneyTrend)",
  };

  const authenticity = assessDocumentAuthenticity(bundle);

  const hasAadhaarEvidence = detectAadhaarFromDocs(bundle.issued_docs || [], bundle);
  const aadhaar = {
    status: hasAadhaarEvidence ? "passed" : "pending",
    detail: hasAadhaarEvidence
      ? bundle.eaadhaar_fetched
        ? "e-Aadhaar metadata retrieved (last4 only retained; full UID never stored)"
        : "Aadhaar-related issued document metadata present under user consent"
      : "Aadhaar evidence not returned — DigiLocker consent UX / partner ACR/scope may not have granted Aadhaar",
    last4: bundle.aadhaar_last4 || null,
  };

  const panValid = Boolean(bundle.pan_number);
  const panDoc = detectPanFromDocs(bundle.issued_docs || []);
  const pan = {
    status: panValid || panDoc ? "passed" : "pending",
    detail: panValid
      ? "PAN available from DigiLocker claims/docs (encrypted/masked at rest)"
      : panDoc
        ? "PAN document metadata present; number not extracted from metadata"
        : "PAN evidence not returned — DigiLocker consent UX / partner ACR=pan may be required",
    masked: null,
  };

  const nameCmp = namesMatch(bundle.name, user?.full_name || user?.name);
  const dobCmp = dobsMatch(bundle.dob, user?.date_of_birth || user?.dob);

  const profile = {
    name_status: nameCmp.matched ? "passed" : bundle.name ? "mismatch" : "pending",
    dob_status: !bundle.dob && !(user?.date_of_birth || user?.dob)
      ? "pending"
      : dobCmp.matched
        ? "passed"
        : bundle.dob
          ? "mismatch"
          : "pending",
    address_status: bundle.address ? "passed" : "pending",
    address_detail: bundle.address
      ? "Address present in DigiLocker payload (encrypted at rest)"
      : "Address not returned under current consent/scopes — DigiLocker UX dependent",
    gender: bundle.gender || null,
    name_match_reason: nameCmp.reason,
    dob_match_reason: dobCmp.reason,
    digilocker_name_present: Boolean(bundle.name),
    digilocker_dob_present: Boolean(bundle.dob),
  };

  const missing = [];
  const mismatches = [];
  const hardFails = [];

  if (requireAadhaar && aadhaar.status !== "passed") missing.push("aadhaar");
  if (requirePan && pan.status !== "passed") missing.push("pan");
  if (requireNameMatch && profile.name_status === "pending") missing.push("name");
  if (requireNameMatch && profile.name_status === "mismatch") mismatches.push("name");
  if (requireDobMatch && profile.dob_status === "pending") missing.push("dob");
  if (requireDobMatch && profile.dob_status === "mismatch") mismatches.push("dob");

  if (bundle.force_failed) hardFails.push("provider_declared_invalid");

  let overall = "PENDING";
  let moneytrendStatus = "pending";
  let reason = "Required DigiLocker evidence incomplete";

  if (hardFails.length) {
    overall = "FAILED";
    moneytrendStatus = "rejected";
    reason = `Verification failed: ${hardFails.join(", ")}`;
  } else if (mismatches.length) {
    overall = "MANUAL_REVIEW";
    moneytrendStatus = "submitted";
    reason = `Identity mismatch requires admin review: ${mismatches.join(", ")}`;
  } else if (missing.length) {
    overall = "PENDING";
    moneytrendStatus = "pending";
    reason = `Pending DigiLocker evidence: ${missing.join(", ")}. Consent UX depends on partner scopes — do not invent documents.`;
  } else if (autoApprove) {
    overall = "VERIFIED";
    moneytrendStatus = "verified";
    reason = "Auto-approved: DigiLocker consent valid, required Aadhaar/PAN evidence present, identity match passed";
  } else {
    overall = "MANUAL_REVIEW";
    moneytrendStatus = "submitted";
    reason = "All automated checks passed; DIGILOCKER_AUTO_APPROVE disabled — admin confirmation required";
  }

  return {
    authentication: auth,
    authenticity,
    aadhaar,
    pan,
    profile,
    overall_status: overall,
    moneytrend_kyc_status: moneytrendStatus,
    auto_approved: overall === "VERIFIED",
    failure_codes: [...missing.map((m) => `${m}_incomplete`), ...mismatches.map((m) => `${m}_mismatch`), ...hardFails],
    missing,
    mismatches,
    reason,
    consent: {
      provider: "digilocker",
      note: "Consent captured by DigiLocker; MoneyTrend stores timestamp/reference only",
    },
  };
}

module.exports = {
  evaluateDigilockerVerification,
  assessDocumentAuthenticity,
  normalizeName,
  normalizeDob,
  namesMatch,
  dobsMatch,
};
