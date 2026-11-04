/**
 * Safe Equifax error mapping — never expose secrets/tokens/PII.
 */

function mapEquifaxError(error) {
  const status = Number(error.status || error.statusCode || 502);
  const rawCode = String(error.code || "").toUpperCase();
  const message = String(error.message || "");
  const details = String(error.details || error.body || "");

  if (rawCode.includes("CONFIG_INCOMPLETE") || rawCode.includes("DISABLED") || rawCode.includes("ENV_MISMATCH")) {
    return {
      status: error.status || (rawCode.includes("ENV") ? 500 : 503),
      code: rawCode,
      message: message || "Equifax configuration error",
      missing: error.missing,
    };
  }

  if (
    status === 401 ||
    /invalid_token|InvalidTokenException|Invalidaccesstoken/i.test(details + message)
  ) {
    return { status: 401, code: "EQUIFAX_INVALID_TOKEN", message: "Equifax authentication failed" };
  }
  if (status === 403) {
    return { status: 403, code: "EQUIFAX_FORBIDDEN", message: "Equifax denied access to this product or resource" };
  }
  if (status === 404 || /404\.01|resource does not exist/i.test(details + message)) {
    return {
      status: 404,
      code: "EQUIFAX_RESOURCE_NOT_FOUND",
      message: "Equifax resource not found. Verify environment, path, entitlements, and token scope.",
    };
  }
  if (status === 400) {
    return { status: 400, code: "EQUIFAX_VALIDATION_ERROR", message: "Equifax rejected the request (validation)" };
  }
  if (status === 409) {
    return { status: 409, code: "EQUIFAX_CONFLICT", message: "Equifax reported a conflict" };
  }
  if (status === 429) {
    return { status: 429, code: "EQUIFAX_RATE_LIMITED", message: "Equifax rate limit exceeded. Try again later." };
  }
  if (status >= 500) {
    return { status: 502, code: "EQUIFAX_UPSTREAM_ERROR", message: "Equifax service is temporarily unavailable" };
  }
  if (rawCode.includes("AUTH")) {
    return { status: 401, code: "EQUIFAX_AUTH_FAILED", message: "Equifax authentication failed" };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: rawCode || "EQUIFAX_REQUEST_FAILED",
    message: message || "Equifax request failed",
  };
}

function sendEquifaxError(res, error) {
  const mapped = mapEquifaxError(error);
  return res.status(mapped.status).json({
    success: false,
    provider: "equifax",
    code: mapped.code,
    message: mapped.message,
    missing: mapped.missing || undefined,
  });
}

module.exports = { mapEquifaxError, sendEquifaxError };
