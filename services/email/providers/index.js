const { getEmailConfig } = require("../emailConfig");
const { createResendProvider } = require("./resendProvider");
const { createSmtpProvider } = require("./smtpProvider");
const { createSandboxProvider } = require("./sandboxProvider");

let cached = null;

function getEmailProvider() {
  if (cached) return cached;

  const { provider } = getEmailConfig();
  if (provider === "resend") {
    cached = createResendProvider();
  } else if (provider === "smtp") {
    cached = createSmtpProvider();
  } else {
    cached = createSandboxProvider();
  }
  return cached;
}

/** Reset cache — used in tests */
function resetEmailProviderCache() {
  cached = null;
}

module.exports = {
  getEmailProvider,
  resetEmailProviderCache,
};
