/**
 * Email / OTP environment configuration.
 * Never logs or returns secrets.
 */

function trim(value) {
  return String(value || "").trim();
}

function getEmailConfig() {
  const fromEmail = trim(process.env.MAIL_FROM_EMAIL || process.env.SUPPORT_EMAIL || "info@moneytrend.in");
  const fromName = trim(process.env.MAIL_FROM_NAME || "MoneyTrend");
  const publicBase = trim(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  const logoPath = trim(process.env.MAIL_LOGO_PATH || "/uploads/money-trend-logo.png");
  const logoUrl =
    trim(process.env.MAIL_LOGO_URL) ||
    (publicBase ? `${publicBase}${logoPath.startsWith("/") ? logoPath : `/${logoPath}`}` : "");

  const provider = trim(process.env.EMAIL_PROVIDER || "").toLowerCase();
  const hasResend = Boolean(trim(process.env.RESEND_API_KEY));
  const hasSmtp = Boolean(
    trim(process.env.SMTP_HOST) &&
      trim(process.env.SMTP_USER) &&
      trim(process.env.SMTP_PASS || process.env.SMTP_PASSWORD)
  );

  let resolvedProvider = provider;
  if (!resolvedProvider) {
    if (hasResend) resolvedProvider = "resend";
    else if (hasSmtp) resolvedProvider = "smtp";
    else resolvedProvider = "sandbox";
  }

  // Prefer real SMTP mailbox when configured (e.g. info@moneytrend.in via GoDaddy)
  if (hasSmtp && (resolvedProvider === "sandbox" || (resolvedProvider === "resend" && !hasResend))) {
    resolvedProvider = "smtp";
  }

  // Safe local fallback: don't crash when provider is set but key missing in non-prod
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!isProd && resolvedProvider === "resend" && !hasResend) {
    resolvedProvider = hasSmtp ? "smtp" : "sandbox";
  }
  if (!isProd && resolvedProvider === "smtp" && !hasSmtp) {
    resolvedProvider = "sandbox";
  }

  return {
    provider: resolvedProvider,
    fromEmail,
    fromName,
    fromHeader: `${fromName} <${fromEmail}>`,
    replyTo: trim(process.env.MAIL_REPLY_TO || fromEmail),
    supportEmail: trim(process.env.SUPPORT_EMAIL || "info@moneytrend.in"),
    logoUrl,
    logoPath,
    publicBaseUrl: publicBase,
    appName: trim(process.env.APP_NAME || "MoneyTrend"),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || process.env.OTP_MAX_VERIFY_ATTEMPTS || 5),
    otpResendCooldownSeconds: Number(
      process.env.OTP_RESEND_COOLDOWN_SECONDS || process.env.OTP_RESEND_COOLDOWN_SEC || 60
    ),
    otpMaxSendsPerEmailWindow: Number(process.env.OTP_MAX_SENDS_PER_EMAIL || process.env.OTP_MAX_SENDS_PER_WINDOW || 5),
    otpSendWindowMinutes: Number(process.env.OTP_SEND_WINDOW_MINUTES || 15),
    otpMaxSendsPerIpWindow: Number(process.env.OTP_MAX_SENDS_PER_IP || 20),
    otpIpWindowMinutes: Number(process.env.OTP_IP_WINDOW_MINUTES || 15),
    hasResend,
    hasSmtp,
  };
}

/**
 * Validate email-related env at startup.
 * Production requires a real provider key; development may use sandbox.
 */
function validateEmailEnv({ exitOnError = false } = {}) {
  const cfg = getEmailConfig();
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const issues = [];

  if (!cfg.fromEmail.includes("@")) {
    issues.push("MAIL_FROM_EMAIL must be a valid email (e.g. info@moneytrend.in)");
  }
  if (isProd && cfg.provider === "sandbox") {
    issues.push("Production requires RESEND_API_KEY or SMTP_* credentials (EMAIL_PROVIDER cannot be sandbox)");
  }
  if (cfg.provider === "resend" && !cfg.hasResend) {
    issues.push("EMAIL_PROVIDER=resend but RESEND_API_KEY is missing");
  }
  if (cfg.provider === "smtp" && !cfg.hasSmtp) {
    issues.push("EMAIL_PROVIDER=smtp but SMTP_HOST/SMTP_USER/SMTP_PASS are incomplete");
  }
  if (isProd && !cfg.logoUrl && !cfg.publicBaseUrl) {
    issues.push("Set MAIL_LOGO_URL or PUBLIC_BASE_URL so OTP emails can load the MoneyTrend logo");
  }

  if (issues.length) {
    const message = `[EMAIL_CONFIG] ${issues.join("; ")}`;
    if (exitOnError && isProd) {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
  } else {
    console.log(
      `[EMAIL_CONFIG] provider=${cfg.provider} from=${cfg.fromEmail} logo=${cfg.logoUrl ? "configured" : "fallback-text"}`
    );
  }

  return { ok: issues.length === 0, issues, config: cfg };
}

module.exports = {
  getEmailConfig,
  validateEmailEnv,
};
