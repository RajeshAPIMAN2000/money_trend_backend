/**
 * Verify SMTP on Hostinger VPS (or local).
 * Usage: node scripts/test-smtp.js [optional-to-email]
 */
const { loadEnv } = require("../config/loadEnv");
loadEnv();

const { getEmailConfig, validateEmailEnv } = require("../services/email/emailConfig");
const { getEmailProvider, resetEmailProviderCache } = require("../services/email/providers");

async function main() {
  validateEmailEnv({ exitOnError: false });
  const cfg = getEmailConfig();
  console.log("[test-smtp] provider=", cfg.provider, "from=", cfg.fromEmail, "host=", cfg.smtpHost);

  if (cfg.provider === "sandbox") {
    console.error(
      "[test-smtp] FAIL: still on sandbox. Set EMAIL_PROVIDER=smtp and SMTP_HOST/USER/PASS in .env on the VPS."
    );
    process.exit(1);
  }

  resetEmailProviderCache();
  const provider = getEmailProvider();

  if (typeof provider.verify === "function") {
    try {
      const v = await provider.verify();
      console.log("[test-smtp] SMTP verify OK:", v);
    } catch (error) {
      console.error("[test-smtp] SMTP verify FAILED:", error.message);
      console.error(
        "Tips: For Hostinger mailbox use SMTP_HOST=smtp.hostinger.com PORT=465 SMTP_SECURE=true. For GoDaddy mailbox use smtpout.secureserver.net. Ensure mailbox password is correct and outbound port 465/587 is open on the VPS."
      );
      process.exit(1);
    }
  }

  const to = String(process.argv[2] || cfg.fromEmail).trim();
  if (!to.includes("@")) {
    console.error("[test-smtp] Pass a valid recipient: node scripts/test-smtp.js you@email.com");
    process.exit(1);
  }

  const result = await provider.send({
    from: cfg.fromHeader,
    to,
    subject: `[MoneyTrend] SMTP test ${new Date().toISOString()}`,
    text: "MoneyTrend Hostinger SMTP test — if you received this, production email works.",
    html: "<p><b>MoneyTrend</b> Hostinger SMTP test — production email works.</p>",
    replyTo: cfg.replyTo,
    emailType: "smtp_test",
  });

  console.log("[test-smtp] send OK:", {
    provider: result.provider,
    messageId: result.messageId,
    status: result.status,
    to,
  });
  process.exit(0);
}

main().catch((error) => {
  console.error("[test-smtp] error:", error.message || error);
  process.exit(1);
});
