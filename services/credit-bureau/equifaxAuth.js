/**
 * Legacy bridge — credit-bureau Equifax pulls use delivery token by default.
 */

const {
  getEquifaxAccessToken,
  getEquifaxAuthHeaders,
  invalidateEquifaxAccessToken,
  clearCachedEquifaxCredential,
  getEquifaxCredentialSnapshot,
} = require("../equifax/equifaxAuth");

async function getEquifaxAccessTokenLegacy(opts = {}) {
  return getEquifaxAccessToken(opts.kind || "delivery", opts);
}

async function getEquifaxAuthHeadersLegacy(extra = {}) {
  return getEquifaxAuthHeaders("delivery", extra);
}

function clearEquifaxTokenCache() {
  clearCachedEquifaxCredential();
}

function getEquifaxTokenSnapshot() {
  const snap = getEquifaxCredentialSnapshot("delivery");
  return {
    hasAccessToken: snap.hasCredential,
    tokenType: snap.tokenType,
    expiresAt: snap.expiresAt,
    issuedAt: snap.issuedAt,
    scope: snap.scope,
    env: snap.env,
    isValid: snap.isValid,
  };
}

module.exports = {
  getEquifaxAccessToken: getEquifaxAccessTokenLegacy,
  getEquifaxAuthHeaders: getEquifaxAuthHeadersLegacy,
  invalidateEquifaxAccessToken: () => invalidateEquifaxAccessToken("delivery"),
  clearEquifaxTokenCache,
  getEquifaxTokenSnapshot,
};
