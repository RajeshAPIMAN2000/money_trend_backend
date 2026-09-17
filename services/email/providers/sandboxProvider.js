const { maskEmail, hashEmailForLog } = require("../../../utils/otpCrypto");

function createSandboxProvider() {
  return {
    name: "sandbox",
    async send({ from, to, subject, emailType }) {
      const result = {
        provider: "sandbox",
        messageId: `sandbox_${Date.now()}`,
        status: "logged",
      };
      console.log("[EMAIL][sandbox]", {
        type: emailType || "generic",
        from,
        to_masked: maskEmail(to),
        to_hash: hashEmailForLog(to),
        subject,
        messageId: result.messageId,
      });
      return result;
    },
  };
}

module.exports = { createSandboxProvider };
