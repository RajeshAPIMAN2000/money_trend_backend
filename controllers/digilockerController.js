const {
  startDigilockerSession,
  handleDigilockerCallback,
  completeStub,
  getDigilockerStatus,
  revokeDigilockerConsent,
} = require("../services/digilocker/digilockerService");
const { getDigilockerConfig } = require("../services/digilocker/digilockerConfig");

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || null;
}

function handleDigilockerError(res, error, fallback) {
  const status = error.status || (error.code === "DIGILOCKER_CONFIG" ? 503 : 500);
  if (status >= 500) {
    console.error(`[DIGILOCKER] ${fallback}:`, error.message);
  }
  return res.status(status).json({
    success: false,
    message: error.message || fallback,
    errorCode: error.code || "DIGILOCKER_ERROR",
    ...(error.extra || {}),
  });
}

function appendQuery(url, params) {
  const u = new URL(url, "https://moneytrend.in");
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  // Production: only allow https frontend redirects (prevent open redirects to http).
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") {
    u.protocol = "https:";
  }
  return u.toString();
}

/** POST /api/digilocker/start  (+ alias /api/kyc/digilocker/init) */
async function startDigilocker(req, res) {
  try {
    const data = await startDigilockerSession({
      userId: req.user.id,
      ipAddress: clientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.json({
      success: true,
      message: data.isStub
        ? "DigiLocker stub mode — call complete-stub to finish"
        : "DigiLocker authorization URL created",
      ...data,
      data,
    });
  } catch (error) {
    return handleDigilockerError(res, error, "Failed to start DigiLocker");
  }
}

/**
 * GET /api/digilocker/callback
 * DigiLocker redirects here (no JWT). Session bound via state → user_id.
 * Then browser is redirected to frontend success/failure URL.
 */
function buildMissingKycMessage(verification = {}) {
  const missing = Array.isArray(verification.missing) ? verification.missing : [];
  const mismatches = Array.isArray(verification.mismatches) ? verification.mismatches : [];
  const labels = {
    aadhaar: "Aadhaar",
    pan: "PAN",
    name: "Name",
    dob: "Date of birth",
  };
  if (missing.length) {
    const list = missing.map((m) => labels[m] || m).join(", ");
    return `eKYC rejected — required data missing: ${list}. Provide correct information in DigiLocker consent (or use Manual KYC).`;
  }
  if (mismatches.length) {
    const list = mismatches.map((m) => labels[m] || m).join(", ");
    return `eKYC needs review — profile mismatch for: ${list}. Update your MoneyTrend profile or retry DigiLocker with correct details.`;
  }
  if (verification.reason) return String(verification.reason);
  return "eKYC rejected — required DigiLocker evidence is incomplete. Provide correct information and try again.";
}

async function digilockerCallback(req, res) {
  const cfg = getDigilockerConfig();
  const wantsJson =
    String(req.query.format || "").toLowerCase() === "json" ||
    String(req.headers.accept || "").includes("application/json");

  try {
    const result = await handleDigilockerCallback({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      errorDescription: req.query.error_description,
      ipAddress: clientIp(req),
      userAgent: req.headers["user-agent"],
    });

    const overall = String(result.verification?.overall_status || "").toUpperCase();
    const kycStatus = String(result.kyc_status || "submitted").toLowerCase();
    const missing = Array.isArray(result.verification?.missing) ? result.verification.missing : [];
    const rejected =
      overall === "FAILED" ||
      kycStatus === "rejected" ||
      (overall === "PENDING" && missing.length > 0);

    if (wantsJson) {
      return res.json({
        success: !rejected,
        message: rejected
          ? buildMissingKycMessage(result.verification)
          : "DigiLocker KYC completed — continue to nominee",
        data: {
          ...result,
          next: rejected ? "kyc" : "nominee",
        },
      });
    }

    if (rejected) {
      const dest = appendQuery(cfg.failureUrl, {
        status: "error",
        error: "DIGILOCKER_KYC_INCOMPLETE",
        kyc_status: kycStatus || "rejected",
        missing: missing.join(","),
        message: buildMissingKycMessage(result.verification),
        session_id: result.session_id,
      });
      return res.redirect(302, dest);
    }

    // OAuth + verification OK (verified / submitted / manual review) → nominee onboarding
    const dest = appendQuery(cfg.nomineeUrl, {
      status: "success",
      kyc_status: kycStatus || "submitted",
      kyc_method: "digilocker",
      session_id: result.session_id,
      next: "nominee",
      from: "digilocker",
    });
    return res.redirect(302, dest);
  } catch (error) {
    if (wantsJson) {
      return handleDigilockerError(res, error, "DigiLocker callback failed");
    }
    const dest = appendQuery(cfg.failureUrl, {
      status: "error",
      error: error.code || "DIGILOCKER_ERROR",
      message: error.message || "DigiLocker failed",
    });
    return res.redirect(302, dest);
  }
}

/** GET /api/digilocker/status (+ /api/kyc/digilocker/status) */
async function digilockerStatus(req, res) {
  try {
    const data = await getDigilockerStatus(req.user.id);
    return res.json({
      success: true,
      message: "DigiLocker KYC status",
      data,
    });
  } catch (error) {
    return handleDigilockerError(res, error, "Failed to fetch DigiLocker status");
  }
}

/** POST /api/kyc/digilocker/complete-stub — development only */
async function digilockerCompleteStub(req, res) {
  try {
    const data = await completeStub({
      userId: req.user.id,
      ipAddress: clientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json({
      success: true,
      message: "DigiLocker stub KYC submitted for admin verification",
      data,
    });
  } catch (error) {
    return handleDigilockerError(res, error, "DigiLocker stub failed");
  }
}

/** GET|POST /api/digilocker/documents — issued-doc metadata only (no binaries / full Aadhaar) */
async function digilockerDocuments(req, res) {
  try {
    const status = await getDigilockerStatus(req.user.id);
    return res.json({
      success: true,
      message: "DigiLocker document metadata",
      data: {
        issued_docs: status.record?.issued_docs || [],
        digilocker_id: status.record?.digilocker_id || null,
        aadhaar_last4: status.record?.aadhaar_last4 || null,
        pan_masked: status.record?.pan_masked || null,
        verification: status.verification || null,
        note: "Raw document binaries and full Aadhaar are not exposed via this API",
      },
    });
  } catch (error) {
    return handleDigilockerError(res, error, "Failed to list DigiLocker documents");
  }
}

/** POST /api/digilocker/revoke — partner revoke API only when approved */
async function digilockerRevoke(req, res) {
  try {
    const data = await revokeDigilockerConsent({ userId: req.user.id });
    return res.json({ success: true, message: "DigiLocker consent revoked", data });
  } catch (error) {
    return handleDigilockerError(res, error, "DigiLocker revoke failed");
  }
}

module.exports = {
  startDigilocker,
  digilockerCallback,
  digilockerStatus,
  digilockerCompleteStub,
  digilockerDocuments,
  digilockerRevoke,
};
