const crypto = require("crypto");
const pool = require("../../config/db");
const { writeAuditLog } = require("../../utils/audit");
const { encryptPii, decryptPii, maskAadhaar, maskPan } = require("../../utils/security");
const { normalizePan, isValidPan } = require("../../utils/validators");
const { getDigilockerConfig, assertLiveConfig } = require("./digilockerConfig");
const { evaluateDigilockerVerification } = require("./kycVerification");
const {
  generateCodeVerifier,
  generateCodeChallengeS256,
  generateOAuthState,
  generateNonce,
} = require("./pkce");

function AppError(message, status = 400, code = "DIGILOCKER_ERROR", extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.extra = extra;
  return err;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeLog(message, meta = {}) {
  const scrubbed = { ...meta };
  for (const key of Object.keys(scrubbed)) {
    if (/secret|token|code|verifier|aadhaar|pan|password|authorization/i.test(key)) {
      scrubbed[key] = "[redacted]";
    }
  }
  console.log(`[DIGILOCKER] ${message}`, scrubbed);
}

/**
 * Start DigiLocker OAuth (PKCE S256). Returns authorization URL for browser redirect.
 */
async function startDigilockerSession({ userId, ipAddress = null, userAgent = null }) {
  const cfg = getDigilockerConfig();

  // Prevent duplicate in-flight OAuth attempts
  const [active] = await pool.query(
    `SELECT id, expires_at FROM digilocker_oauth_sessions
     WHERE user_id = :userId AND status = 'pending' AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    { userId }
  );
  if (active[0]) {
    // Expire the old pending session so a fresh challenge is always generated
    await pool.query(
      `UPDATE digilocker_oauth_sessions SET status = 'expired', updated_at = NOW() WHERE id = :id`,
      { id: active[0].id }
    );
  }

  if (cfg.stubMode) {
    await writeAuditLog({
      userId,
      action: "DIGILOCKER_START_STUB",
      entityType: "digilocker_session",
      ipAddress,
      userAgent,
      meta: { stub: true, credentials_ready: cfg.credentialsReady },
    });
    return {
      isStub: true,
      is_stub: true,
      authUrl: null,
      auth_url: null,
      authorization_url: null,
      message: cfg.credentialsReady
        ? "DigiLocker stub mode enabled (DIGILOCKER_STUB=true)"
        : "DigiLocker credentials missing — stub mode active",
    };
  }

  assertLiveConfig(cfg);

  const codeVerifier = generateCodeVerifier(64);
  const codeChallenge = generateCodeChallengeS256(codeVerifier);
  const state = generateOAuthState();
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + cfg.sessionTtlMinutes * 60 * 1000);

  // Invalidate prior open sessions for this user (one active attempt)
  await pool.query(
    `UPDATE digilocker_oauth_sessions
     SET status = 'expired', updated_at = NOW()
     WHERE user_id = :userId AND status = 'pending'`,
    { userId }
  );

  const [ins] = await pool.query(
    `INSERT INTO digilocker_oauth_sessions
      (user_id, state, code_verifier, nonce, status, redirect_uri, scope, expires_at, ip_address, user_agent)
     VALUES
      (:userId, :state, :codeVerifier, :nonce, 'pending', :redirectUri, :scope, :expiresAt, :ipAddress, :userAgent)`,
    {
      userId,
      state,
      codeVerifier: encryptPii(codeVerifier),
      nonce,
      redirectUri: cfg.redirectUri,
      scope: cfg.scope,
      expiresAt,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
    }
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  if (cfg.scope) params.set("scope", cfg.scope);
  if (cfg.acr) params.set("acr", cfg.acr);
  if (cfg.purpose) params.set("purpose", cfg.purpose);
  // OpenID nonce when requesting openid scope
  if (/\bopenid\b/i.test(cfg.scope)) params.set("nonce", nonce);

  const authUrl = `${cfg.authorizeUrl}?${params.toString()}`;

  await writeAuditLog({
    userId,
    action: "DIGILOCKER_START",
    entityType: "digilocker_session",
    entityId: ins.insertId,
    ipAddress,
    userAgent,
    meta: { session_id: ins.insertId, scope: cfg.scope, acr: cfg.acr || null },
  });

  safeLog("session started", { session_id: ins.insertId, user_id: userId });

  return {
    isStub: false,
    is_stub: false,
    session_id: ins.insertId,
    authUrl,
    auth_url: authUrl,
    authorization_url: authUrl,
    expires_at: expiresAt.toISOString(),
  };
}

async function loadPendingSessionByState(state) {
  const [rows] = await pool.query(
    `SELECT * FROM digilocker_oauth_sessions
     WHERE state = :state
     LIMIT 1`,
    { state: String(state || "") }
  );
  return rows[0] || null;
}

/**
 * Atomically consume a pending session (prevents replay).
 */
async function consumeSession(sessionId) {
  const [result] = await pool.query(
    `UPDATE digilocker_oauth_sessions
     SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
     WHERE id = :id AND status = 'pending' AND expires_at > NOW()`,
    { id: sessionId }
  );
  return Number(result.affectedRows || 0) === 1;
}

async function exchangeAuthorizationCode({ code, codeVerifier, redirectUri }) {
  const cfg = getDigilockerConfig();
  assertLiveConfig(cfg);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: redirectUri || cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetchWithTimeout(
    cfg.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    },
    cfg.httpTimeoutMs
  );

  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    throw AppError("Invalid DigiLocker token response", 502, "DIGILOCKER_TOKEN_INVALID");
  }

  if (!res.ok || !json.access_token) {
    safeLog("token exchange failed", { status: res.status, error: json.error });
    throw AppError(
      json.error_description || json.error || "DigiLocker token exchange failed",
      400,
      "DIGILOCKER_TOKEN_FAILED",
      { provider_error: json.error || null }
    );
  }

  return json;
}

/**
 * Minimal JWT payload decode for id_token claims (no signature verification without JWKS URL).
 * Spec does not publish JWKS in the extracted partner PDF used here — we validate aud/iss/exp when present
 * and treat missing JWKS as an outstanding partner requirement.
 */
function decodeJwtPayload(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(json);
  } catch (_e) {
    return null;
  }
}

function validateIdTokenClaims(payload, { clientId, nonce }) {
  if (!payload) return { ok: false, reason: "missing_id_token_payload" };
  if (payload.aud && String(payload.aud) !== String(clientId)) {
    return { ok: false, reason: "aud_mismatch" };
  }
  if (payload.exp && Number(payload.exp) * 1000 < Date.now() - 60000) {
    return { ok: false, reason: "expired" };
  }
  if (nonce && payload.nonce && String(payload.nonce) !== String(nonce)) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  // Signature verification requires DigiLocker JWKS — flagged separately.
  return { ok: true, signature_verified: false };
}

async function digilockerGet(url, accessToken, timeoutMs) {
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
    timeoutMs
  );
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}

function extractAadhaarLast4FromXml(xml) {
  const text = String(xml || "");
  // Prefer masked forms; never log full UID.
  const masked = text.match(/\bxxxx[xX]*(\d{4})\b/i) || text.match(/\*{4,}(\d{4})\b/);
  if (masked) return masked[1];
  const uid = text.match(/\buid=["'](\d{12})["']/i);
  if (uid) return uid[1].slice(-4);
  return null;
}

function extractNameFromXml(xml) {
  const m = String(xml || "").match(/\bname=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

async function fetchIdentityBundle(accessToken, tokenPayload = {}) {
  const cfg = getDigilockerConfig();
  const bundle = {
    digilocker_id: tokenPayload.digilockerid || null,
    name: tokenPayload.name || null,
    dob: tokenPayload.dob || null,
    gender: tokenPayload.gender || null,
    eaadhaar: tokenPayload.eaadhaar || null,
    reference_key: tokenPayload.reference_key || null,
    mobile: tokenPayload.mobile || null,
    email: tokenPayload.email || null,
    pan_number: tokenPayload.pan_number || null,
    aadhaar_last4: null,
    issued_docs: [],
    eaadhaar_fetched: false,
    user_details_fetched: false,
  };

  // Get User Details (documented)
  try {
    const userRes = await digilockerGet(cfg.userDetailsUrl, accessToken, cfg.httpTimeoutMs);
    if (userRes.ok && userRes.json) {
      bundle.user_details_fetched = true;
      bundle.digilocker_id = userRes.json.digilockerid || bundle.digilocker_id;
      bundle.name = userRes.json.name || bundle.name;
      bundle.dob = userRes.json.dob || bundle.dob;
      bundle.gender = userRes.json.gender || bundle.gender;
      bundle.eaadhaar = userRes.json.eaadhaar || bundle.eaadhaar;
      bundle.reference_key = userRes.json.reference_key || bundle.reference_key;
      bundle.mobile = userRes.json.mobile || bundle.mobile;
      bundle.email = userRes.json.email || bundle.email;
    }
  } catch (e) {
    safeLog("user details fetch failed", { message: e.message });
  }

  // e-Aadhaar XML when available (documented /oauth2/3/xml/eaadhaar)
  if (String(bundle.eaadhaar || "").toUpperCase() === "Y") {
    try {
      const ea = await digilockerGet(cfg.eaadhaarXmlUrl, accessToken, cfg.httpTimeoutMs);
      if (ea.ok && ea.text) {
        bundle.eaadhaar_fetched = true;
        bundle.aadhaar_last4 = extractAadhaarLast4FromXml(ea.text);
        if (!bundle.name) bundle.name = extractNameFromXml(ea.text);
      }
    } catch (e) {
      safeLog("eaadhaar fetch failed", { message: e.message });
    }
  }

  // Issued documents metadata (documented) — store metadata only
  try {
    const docs = await digilockerGet(cfg.issuedDocsUrl, accessToken, cfg.httpTimeoutMs);
    if (docs.ok && docs.json) {
      const list = Array.isArray(docs.json.items)
        ? docs.json.items
        : Array.isArray(docs.json)
          ? docs.json
          : docs.json.documents || [];
      bundle.issued_docs = list.slice(0, 50).map((d) => ({
        name: d.name || null,
        doctype: d.doctype || d.type || null,
        issuerid: d.issuerid || d.issuer || null,
        uri: d.uri ? String(d.uri).slice(0, 191) : null,
        date: d.date || null,
      }));
      // Attempt PAN detection from doc names/types without downloading file binary by default
      for (const d of bundle.issued_docs) {
        const label = `${d.name || ""} ${d.doctype || ""}`.toUpperCase();
        if (label.includes("PAN") && !bundle.pan_number) {
          // PAN number may appear in URI suffix per scope examples — extract if valid
          const maybe = String(d.uri || "").match(/([A-Z]{5}[0-9]{4}[A-Z])/i);
          if (maybe && isValidPan(normalizePan(maybe[1]))) {
            bundle.pan_number = normalizePan(maybe[1]);
          }
        }
      }
    }
  } catch (e) {
    safeLog("issued docs fetch failed", { message: e.message });
  }

  // id_token may carry pan_number / masked_aadhaar when ACR was used
  return bundle;
}

async function persistDigilockerKyc({ userId, sessionId, bundle, idTokenClaims = null }) {
  const cfg = getDigilockerConfig();
  const name = String(bundle.name || idTokenClaims?.given_name || "").trim() || "DigiLocker User";
  const panFromToken = normalizePan(bundle.pan_number || idTokenClaims?.pan_number || "");
  const panNumber = panFromToken && isValidPan(panFromToken) ? panFromToken : "DLCKRPAN00";
  const aadhaarLast4 =
    bundle.aadhaar_last4 ||
    (idTokenClaims?.masked_aadhaar
      ? String(idTokenClaims.masked_aadhaar).replace(/\D/g, "").slice(-4)
      : null);
  // Store last-4 padded placeholder when full Aadhaar is not retained (privacy).
  const aadhaarStored = aadhaarLast4
    ? `XXXXXXXX${aadhaarLast4}`
    : "XXXXXXXX0000";

  const digilockerRef = String(
    bundle.digilocker_id || bundle.reference_key || `DL-${sessionId}`
  ).slice(0, 191);

  const [userRows] = await pool.query(
    `SELECT id, full_name, date_of_birth, email, phone FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );
  const user = userRows[0] || { id: userId };

  const verification = evaluateDigilockerVerification({
    bundle: {
      ...bundle,
      pan_number: panFromToken && isValidPan(panFromToken) ? panFromToken : null,
      name,
    },
    user,
    options: {
      autoApprove: cfg.autoApprove,
      requireAadhaar: cfg.requireAadhaar,
      requirePan: cfg.requirePan,
      requireNameMatch: cfg.requireNameMatch,
      requireDobMatch: cfg.requireDobMatch,
    },
  });

  if (panFromToken && isValidPan(panFromToken)) {
    verification.pan.masked = maskPan(panFromToken);
  }

  // digilocker_kyc_records.status enum: submitted | verified | rejected
  const recordStatus =
    verification.overall_status === "VERIFIED"
      ? "verified"
      : verification.overall_status === "FAILED"
        ? "rejected"
        : "submitted";
  const kycDocStatus = recordStatus === "verified" ? "verified" : recordStatus === "rejected" ? "rejected" : "submitted";
  const userKycStatus = verification.moneytrend_kyc_status;
  const consentAt = new Date();
  const verifiedAt = verification.overall_status === "VERIFIED" ? consentAt : null;

  await pool.query(
    `INSERT INTO kyc_documents
      (user_id, method, pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image, digilocker_ref, status)
     VALUES
      (:userId, 'digilocker', :panNumber, :panFullName, NULL, :aadhaarNumber, NULL, :digilockerRef, :status)
     ON DUPLICATE KEY UPDATE
      method = 'digilocker',
      pan_number = VALUES(pan_number),
      pan_full_name = VALUES(pan_full_name),
      aadhaar_number = VALUES(aadhaar_number),
      digilocker_ref = VALUES(digilocker_ref),
      status = VALUES(status)`,
    {
      userId,
      panNumber: panNumber.slice(0, 20),
      panFullName: name.slice(0, 150),
      aadhaarNumber: aadhaarStored.slice(0, 20),
      digilockerRef,
      status: kycDocStatus,
    }
  );

  await pool.query(
    `UPDATE users SET kyc_status = :kycStatus, kyc_method = 'digilocker' WHERE id = :userId`,
    { userId, kycStatus: userKycStatus }
  );

  const panMasked = panFromToken && isValidPan(panFromToken) ? maskPan(panFromToken) : null;

  await pool.query(
    `INSERT INTO digilocker_kyc_records
      (user_id, session_id, digilocker_id, full_name_enc, dob_enc, gender, aadhaar_last4,
       pan_masked, eaadhaar_available, issued_docs_json, consent_meta_json,
       auth_status, aadhaar_status, pan_status, name_status, dob_status, address_status,
       overall_status, review_reason, verification_json, authenticity_json, address_enc,
       consent_at, verified_at, consent_ref, status)
     VALUES
      (:userId, :sessionId, :digilockerId, :fullNameEnc, :dobEnc, :gender, :aadhaarLast4,
       :panMasked, :eaadhaar, :issuedDocs, :consentMeta,
       :authStatus, :aadhaarStatus, :panStatus, :nameStatus, :dobStatus, :addressStatus,
       :overallStatus, :reviewReason, :verificationJson, :authenticityJson, :addressEnc,
       :consentAt, :verifiedAt, :consentRef, :status)
     ON DUPLICATE KEY UPDATE
      session_id = VALUES(session_id),
      digilocker_id = VALUES(digilocker_id),
      full_name_enc = VALUES(full_name_enc),
      dob_enc = VALUES(dob_enc),
      gender = VALUES(gender),
      aadhaar_last4 = VALUES(aadhaar_last4),
      pan_masked = VALUES(pan_masked),
      eaadhaar_available = VALUES(eaadhaar_available),
      issued_docs_json = VALUES(issued_docs_json),
      consent_meta_json = VALUES(consent_meta_json),
      auth_status = VALUES(auth_status),
      aadhaar_status = VALUES(aadhaar_status),
      pan_status = VALUES(pan_status),
      name_status = VALUES(name_status),
      dob_status = VALUES(dob_status),
      address_status = VALUES(address_status),
      overall_status = VALUES(overall_status),
      review_reason = VALUES(review_reason),
      verification_json = VALUES(verification_json),
      authenticity_json = VALUES(authenticity_json),
      address_enc = VALUES(address_enc),
      consent_at = VALUES(consent_at),
      verified_at = VALUES(verified_at),
      consent_ref = VALUES(consent_ref),
      status = VALUES(status),
      updated_at = NOW()`,
    {
      userId,
      sessionId,
      digilockerId: bundle.digilocker_id || null,
      fullNameEnc: encryptPii(name),
      dobEnc: bundle.dob ? encryptPii(String(bundle.dob)) : null,
      gender: bundle.gender ? String(bundle.gender).slice(0, 8) : null,
      aadhaarLast4: aadhaarLast4 || null,
      panMasked,
      eaadhaar: String(bundle.eaadhaar || "").toUpperCase() === "Y" ? 1 : 0,
      issuedDocs: JSON.stringify(bundle.issued_docs || []),
      consentMeta: JSON.stringify({
        source: "digilocker_oauth",
        issuer_id: cfg.issuerId,
        user_details_fetched: bundle.user_details_fetched,
        eaadhaar_fetched: bundle.eaadhaar_fetched,
        note: "OTP/PIN never received by MoneyTrend; full Aadhaar never stored; tokens never stored",
      }),
      authStatus: verification.authentication.status,
      aadhaarStatus: verification.aadhaar.status,
      panStatus: verification.pan.status,
      nameStatus: verification.profile.name_status,
      dobStatus: verification.profile.dob_status,
      addressStatus: verification.profile.address_status,
      overallStatus: verification.overall_status,
      reviewReason: String(verification.reason || "").slice(0, 500),
      verificationJson: JSON.stringify(verification),
      authenticityJson: JSON.stringify(verification.authenticity || {}),
      addressEnc: bundle.address ? encryptPii(String(bundle.address).slice(0, 500)) : null,
      consentAt,
      verifiedAt,
      consentRef: digilockerRef,
      status: recordStatus,
    }
  );

  try {
    await pool.query(
      `INSERT INTO digilocker_kyc_audit_logs (user_id, session_id, action, detail_json, actor)
       VALUES (:userId, :sessionId, :action, :detail, 'system')`,
      {
        userId,
        sessionId,
        action: verification.auto_approved ? "DIGILOCKER_AUTO_VERIFIED" : "DIGILOCKER_KYC_SUBMITTED",
        detail: JSON.stringify({
          overall_status: verification.overall_status,
          failure_codes: verification.failure_codes,
          // Never log PAN/Aadhaar/name/DOB values
        }),
      }
    );
  } catch (_e) {
    // Audit table may not exist until ensureCoreTables runs
  }

  return {
    digilocker_ref: digilockerRef,
    pan_masked: panMasked,
    aadhaar_masked: aadhaarLast4 ? maskAadhaar(`XXXXXXXX${aadhaarLast4}`) : null,
    full_name: name,
    kyc_status: userKycStatus,
    moneytrend_approval: userKycStatus === "verified" ? "approved" : "pending_admin",
    verification,
  };
}

/**
 * Handle DigiLocker redirect callback (code + state).
 */
async function handleDigilockerCallback({
  code,
  state,
  error,
  errorDescription,
  ipAddress = null,
  userAgent = null,
}) {
  if (error) {
    safeLog("provider returned error", { error });
    throw AppError(
      errorDescription || error || "DigiLocker authorization denied",
      400,
      "DIGILOCKER_DENIED",
      { provider_error: error }
    );
  }
  if (!code || !state) {
    throw AppError("Missing authorization code or state", 400, "DIGILOCKER_CALLBACK_INVALID");
  }

  const session = await loadPendingSessionByState(state);
  if (!session) {
    throw AppError("Invalid or unknown DigiLocker state", 400, "DIGILOCKER_STATE_INVALID");
  }
  if (session.status !== "pending") {
    throw AppError("DigiLocker session already used or closed", 400, "DIGILOCKER_REPLAY");
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await pool.query(
      `UPDATE digilocker_oauth_sessions SET status = 'expired', updated_at = NOW() WHERE id = :id`,
      { id: session.id }
    );
    throw AppError("DigiLocker session expired", 400, "DIGILOCKER_EXPIRED");
  }

  const consumed = await consumeSession(session.id);
  if (!consumed) {
    throw AppError("DigiLocker session already consumed", 400, "DIGILOCKER_REPLAY");
  }

  const codeVerifier = decryptPii(session.code_verifier);
  if (!codeVerifier) {
    throw AppError("Unable to recover DigiLocker PKCE verifier", 500, "DIGILOCKER_VERIFIER");
  }

  const tokenJson = await exchangeAuthorizationCode({
    code,
    codeVerifier,
    redirectUri: session.redirect_uri,
  });

  const cfg = getDigilockerConfig();
  const idClaims = decodeJwtPayload(tokenJson.id_token);
  const claimCheck = validateIdTokenClaims(idClaims, {
    clientId: cfg.clientId,
    nonce: session.nonce,
  });
  if (idClaims && !claimCheck.ok) {
    safeLog("id_token claim validation failed", { reason: claimCheck.reason });
    throw AppError("DigiLocker id_token validation failed", 400, "DIGILOCKER_ID_TOKEN", {
      reason: claimCheck.reason,
    });
  }

  // Access token held only in memory for this request — not persisted.
  const bundle = await fetchIdentityBundle(tokenJson.access_token, tokenJson);
  if (idClaims?.pan_number && !bundle.pan_number) bundle.pan_number = idClaims.pan_number;

  const persisted = await persistDigilockerKyc({
    userId: session.user_id,
    sessionId: session.id,
    bundle,
    idTokenClaims: idClaims,
  });

  await pool.query(
    `UPDATE digilocker_oauth_sessions
     SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
         digilocker_id = :digilockerId,
         result_meta_json = :meta
     WHERE id = :id`,
    {
      id: session.id,
      digilockerId: bundle.digilocker_id || null,
      meta: JSON.stringify({
        scopes: tokenJson.scope || null,
        eaadhaar: bundle.eaadhaar || null,
        issued_docs_count: (bundle.issued_docs || []).length,
        id_token_signature_verified: false,
        outstanding: "JWKS signature verification requires DigiLocker JWKS endpoint from partner portal",
      }),
    }
  );

  await writeAuditLog({
    userId: session.user_id,
    action: "DIGILOCKER_CALLBACK_SUCCESS",
    entityType: "digilocker_session",
    entityId: session.id,
    ipAddress,
    userAgent,
    meta: {
      digilocker_ref: persisted.digilocker_ref,
      pan_masked: persisted.pan_masked,
      aadhaar_masked: persisted.aadhaar_masked,
    },
  });

  return {
    user_id: session.user_id,
    session_id: session.id,
    ...persisted,
  };
}

async function completeStub({ userId, ipAddress = null, userAgent = null }) {
  const cfg = getDigilockerConfig();
  const stubForced = ["1", "true", "yes"].includes(
    String(process.env.DIGILOCKER_STUB || "").trim().toLowerCase()
  );
  if (process.env.NODE_ENV === "production" && !stubForced && !cfg.stubMode) {
    throw AppError("DigiLocker stub is disabled in production", 403, "DIGILOCKER_STUB_DISABLED");
  }

  const digilockerRef = `STUB-${userId}-${Date.now()}`;
  const bundle = {
    digilocker_id: digilockerRef,
    name: "Stub DigiLocker User",
    dob: null,
    gender: null,
    eaadhaar: "N",
    reference_key: digilockerRef,
    pan_number: null,
    aadhaar_last4: "0000",
    issued_docs: [],
    user_details_fetched: false,
    eaadhaar_fetched: false,
  };

  const [ins] = await pool.query(
    `INSERT INTO digilocker_oauth_sessions
      (user_id, state, code_verifier, nonce, status, redirect_uri, scope, expires_at, consumed_at, completed_at, digilocker_id, result_meta_json, ip_address, user_agent)
     VALUES
      (:userId, :state, :verifier, :nonce, 'completed', :redirectUri, 'stub', DATE_ADD(NOW(), INTERVAL 1 HOUR), NOW(), NOW(), :digilockerId, :meta, :ip, :ua)`,
    {
      userId,
      state: `stub_${crypto.randomBytes(8).toString("hex")}`,
      verifier: encryptPii(`stub_verifier_${crypto.randomBytes(16).toString("hex")}`),
      nonce: generateNonce(),
      redirectUri: cfg.redirectUri,
      digilockerId: digilockerRef,
      meta: JSON.stringify({ stub: true }),
      ip: ipAddress,
      ua: userAgent ? String(userAgent).slice(0, 500) : null,
    }
  );

  const persisted = await persistDigilockerKyc({
    userId,
    sessionId: ins.insertId,
    bundle,
  });

  await writeAuditLog({
    userId,
    action: "DIGILOCKER_STUB_COMPLETE",
    entityType: "digilocker_session",
    entityId: ins.insertId,
    ipAddress,
    userAgent,
    meta: { digilocker_ref: digilockerRef },
  });

  return {
    session_id: ins.insertId,
    ...persisted,
    is_stub: true,
  };
}

async function getDigilockerStatus(userId) {
  const [users] = await pool.query(
    `SELECT id, kyc_status, kyc_method FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );
  const user = users[0];
  if (!user) throw AppError("User not found", 404, "NOT_FOUND");

  const [sessions] = await pool.query(
    `SELECT id, status, digilocker_id, expires_at, consumed_at, completed_at, created_at, result_meta_json
     FROM digilocker_oauth_sessions
     WHERE user_id = :userId
     ORDER BY id DESC
     LIMIT 5`,
    { userId }
  );

  const [records] = await pool.query(
    `SELECT id, digilocker_id, aadhaar_last4, pan_masked, eaadhaar_available, status, issued_docs_json,
            auth_status, aadhaar_status, pan_status, name_status, dob_status, address_status,
            overall_status, review_reason, verification_json, created_at, updated_at
     FROM digilocker_kyc_records
     WHERE user_id = :userId
     LIMIT 1`,
    { userId }
  );

  const [kyc] = await pool.query(
    `SELECT method, status, digilocker_ref, pan_full_name, created_at, updated_at
     FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
    { userId }
  );

  const record = records[0] || null;
  let issuedDocs = [];
  if (record?.issued_docs_json) {
    try {
      issuedDocs =
        typeof record.issued_docs_json === "string"
          ? JSON.parse(record.issued_docs_json)
          : record.issued_docs_json;
    } catch (_e) {
      issuedDocs = [];
    }
  }

  let verification = null;
  if (record?.verification_json) {
    try {
      verification =
        typeof record.verification_json === "string"
          ? JSON.parse(record.verification_json)
          : record.verification_json;
    } catch (_e) {
      verification = null;
    }
  }

  const digilockerAuthOk = Boolean(
    record && ["submitted", "verified"].includes(String(record.status || "").toLowerCase())
  );

  return {
    user_id: userId,
    kyc_status: user.kyc_status,
    kyc_method: user.kyc_method,
    digilocker_provider_verified: digilockerAuthOk,
    moneytrend_approval: user.kyc_status === "verified" ? "approved" : "pending_admin",
    verification: {
      authentication: record?.auth_status || verification?.authentication?.status || (digilockerAuthOk ? "passed" : "not_started"),
      aadhaar: record?.aadhaar_status || verification?.aadhaar?.status || "not_started",
      pan: record?.pan_status || verification?.pan?.status || "not_started",
      name: record?.name_status || verification?.profile?.name_status || "not_started",
      dob: record?.dob_status || verification?.profile?.dob_status || "not_started",
      address: record?.address_status || verification?.profile?.address_status || "not_started",
      overall: record?.overall_status || verification?.overall_status || "not_started",
      reason: record?.review_reason || verification?.reason || null,
    },
    latest_sessions: sessions.map((s) => ({
      id: s.id,
      status: s.status,
      digilocker_id: s.digilocker_id,
      expires_at: s.expires_at,
      completed_at: s.completed_at,
      created_at: s.created_at,
    })),
    record: record
      ? {
          digilocker_id: record.digilocker_id,
          aadhaar_last4: record.aadhaar_last4,
          pan_masked: record.pan_masked,
          eaadhaar_available: Boolean(record.eaadhaar_available),
          status: record.status,
          issued_docs: issuedDocs,
          updated_at: record.updated_at,
        }
      : null,
    kyc_document: kyc[0]
      ? {
          method: kyc[0].method,
          status: kyc[0].status,
          digilocker_ref: kyc[0].digilocker_ref,
          pan_full_name: kyc[0].pan_full_name,
          updated_at: kyc[0].updated_at,
        }
      : null,
  };
}

/**
 * Consent / token revocation — only when DIGILOCKER_REVOKE_URL is configured by partner.
 */
async function revokeDigilockerConsent({ userId }) {
  const cfg = getDigilockerConfig();
  if (!cfg.revokeUrl) {
    throw AppError(
      "DigiLocker consent revocation endpoint is not enabled for this partner account. Request revoke API access from DigiLocker support.",
      501,
      "DIGILOCKER_REVOKE_UNSUPPORTED"
    );
  }
  // Partner revoke URL present but request shape is not yet confirmed in MoneyTrend docs.
  throw AppError(
    "DigiLocker revoke URL is configured but request contract is pending partner confirmation",
    501,
    "DIGILOCKER_REVOKE_PENDING_SPEC",
    { user_id: userId }
  );
}

module.exports = {
  startDigilockerSession,
  handleDigilockerCallback,
  completeStub,
  getDigilockerStatus,
  revokeDigilockerConsent,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateCodeChallengeS256,
  validateIdTokenClaims,
  decodeJwtPayload,
  evaluateDigilockerVerification,
  AppError,
};
