const VALID_BUREAUS = ["CIBIL", "EXPERIAN", "EQUIFAX", "CRIF"];

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || null;
}

function validateCreditCheckConsent(req, res, next) {
  const body = req.body || {};
  const consentGiven =
    body.consent_given === true ||
    body.consentGiven === true ||
    body.consent === true;

  const consentVersion = String(
    body.consent_version || body.consentVersion || ""
  ).trim();

  if (!consentGiven) {
    return res.status(400).json({
      success: false,
      message:
        "Explicit user consent is required before a credit bureau pull (consent_given: true)",
    });
  }

  if (!consentVersion) {
    return res.status(400).json({
      success: false,
      message: "consent_version is required for audit compliance",
    });
  }

  req.creditConsent = {
    consentGiven: true,
    consentTimestamp: new Date(),
    consentIp: getClientIp(req),
    consentVersion,
  };

  return next();
}

function validateBureau(req, res, next) {
  const bureau = String(req.body?.bureau || "CIBIL").toUpperCase();
  if (!VALID_BUREAUS.includes(bureau)) {
    return res.status(400).json({
      success: false,
      message: `Invalid bureau. Supported: ${VALID_BUREAUS.join(", ")}`,
    });
  }
  req.body.bureau = bureau;
  return next();
}

module.exports = {
  validateCreditCheckConsent,
  validateBureau,
  getClientIp,
  VALID_BUREAUS,
};
