/**
 * Email / OTP environment configuration.
 * Never logs or returns secrets.
 * Production (Hostinger VPS) must use real SMTP — sandbox is blocked.
 */

function trim(value) {
  return String(value || "").trim();
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function smtpCredentialStatus() {
  const host = trim(process.env.SMTP_HOST);
  const user = trim(process.env.SMTP_USER);
  const pass = trim(process.env.SMTP_PASS || process.env.SMTP_PASSWORD);
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  return {
    host,
    user,
    hasPass: Boolean(pass),
    missing,
    complete: missing.length === 0,
  };
}

function getEmailConfig() {
  const fromEmail = trim(
    process.env.MAIL_FROM_EMAIL || process.env.SUPPORT_EMAIL || "info@moneytrend.in"
  );
  const fromName = trim(process.env.MAIL_FROM_NAME || "MoneyTrend");
  const publicBase = trim(
    process.env.PUBLIC_BASE_URL ||
      process.env.APP_URL ||
      process.env.FRONTEND_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      ""
  )
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  const logoPath = trim(process.env.MAIL_LOGO_PATH || "/uploads/money-trend-logo.png");
  const logoUrl =
    trim(process.env.MAIL_LOGO_URL) ||
    (publicBase ? `${publicBase}${logoPath.startsWith("/") ? logoPath : `/${logoPath}`}` : "");

  const providerRaw = trim(process.env.EMAIL_PROVIDER || "").toLowerCase();
  const hasResend = Boolean(trim(process.env.RESEND_API_KEY));
  const smtpStatus = smtpCredentialStatus();
  const hasSmtp = smtpStatus.complete;

  let resolvedProvider = providerRaw;
  if (!resolvedProvider) {
    if (hasSmtp) resolvedProvider = "smtp";
    else if (hasResend) resolvedProvider = "resend";
    else resolvedProvider = isProduction() ? "smtp" : "sandbox";
  }

  // Prefer real SMTP when credentials exist (Hostinger / GoDaddy mailbox)
  if (hasSmtp && (resolvedProvider === "sandbox" || (resolvedProvider === "resend" && !hasResend))) {
    resolvedProvider = "smtp";
  }

  // Never allow sandbox in production — force SMTP/Resend or fail validation
  if (isProduction() && resolvedProvider === "sandbox") {
    if (hasSmtp) resolvedProvider = "smtp";
    else if (hasResend) resolvedProvider = "resend";
  }

  // Local/dev soft fallback only when SMTP was never intended
  if (!isProduction() && resolvedProvider === "resend" && !hasResend) {
    resolvedProvider = hasSmtp ? "smtp" : "sandbox";
  }
  // If EMAIL_PROVIDER=smtp but credentials incomplete: keep "smtp" so validation fails clearly
  // (do NOT silently switch to sandbox when host is already set)
  if (!isProduction() && resolvedProvider === "smtp" && !hasSmtp && !smtpStatus.host) {
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
    appName: trim(process.env.APP_NAME || "Money Trend"),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || process.env.OTP_MAX_VERIFY_ATTEMPTS || 5),
    otpResendCooldownSeconds: Number(
      process.env.OTP_RESEND_COOLDOWN_SECONDS || process.env.OTP_RESEND_COOLDOWN_SEC || 60
    ),
    otpMaxSendsPerEmailWindow: Number(
      process.env.OTP_MAX_SENDS_PER_EMAIL || process.env.OTP_MAX_SENDS_PER_WINDOW || 5
    ),
    otpSendWindowMinutes: Number(process.env.OTP_SEND_WINDOW_MINUTES || 15),
    otpMaxSendsPerIpWindow: Number(process.env.OTP_MAX_SENDS_PER_IP || 20),
    otpIpWindowMinutes: Number(process.env.OTP_IP_WINDOW_MINUTES || 15),
    hasResend,
    hasSmtp,
    smtpHost: smtpStatus.host,
    smtpPort: Number(process.env.SMTP_PORT || 465),
    smtpMissing: smtpStatus.missing,
    isProduction: isProduction(),
  };
}

/**
 * Validate email-related env at startup.
 * Production requires real SMTP (Hostinger recommended) — sandbox is not allowed.
 */
function validateEmailEnv({ exitOnError = false } = {}) {
  const cfg = getEmailConfig();
  const issues = [];

  if (!cfg.fromEmail.includes("@")) {
    issues.push("MAIL_FROM_EMAIL must be a valid email (e.g. info@moneytrend.in)");
  }

  if (cfg.smtpMissing.length && (cfg.provider === "smtp" || cfg.isProduction || cfg.smtpHost)) {
    issues.push(
      `SMTP incomplete — missing ${cfg.smtpMissing.join(", ")}. Example: SMTP_USER=info@domain.com SMTP_PASS=mailbox_password SMTP_HOST=smtp.hostinger.com`
    );
  }

  if (cfg.isProduction && cfg.provider === "sandbox") {
    issues.push(
      "Production forbids sandbox email. Set EMAIL_PROVIDER=smtp and complete SMTP_HOST/SMTP_USER/SMTP_PASS"
    );
  }
  if (cfg.provider === "resend" && !cfg.hasResend) {
    issues.push("EMAIL_PROVIDER=resend but RESEND_API_KEY is missing");
  }
  if (cfg.provider === "smtp" && !cfg.hasSmtp) {
    issues.push(
      "EMAIL_PROVIDER=smtp but SMTP credentials incomplete (check SMTP_PASS is set and not empty)"
    );
  }
  if (cfg.isProduction && !cfg.logoUrl && !cfg.publicBaseUrl) {
    issues.push("Set MAIL_LOGO_URL or PUBLIC_BASE_URL so OTP emails can load the MoneyTrend logo");
  }

  const hardFail =
    exitOnError &&
    (cfg.isProduction || cfg.provider === "smtp" || Boolean(cfg.smtpHost));

  if (issues.length) {
    const message = `[EMAIL_CONFIG] ${issues.join("; ")}`;
    if (hardFail && (cfg.isProduction || !cfg.hasSmtp)) {
      // On VPS / when SMTP intended: stop startup so OTP does not silently sandbox
      if (cfg.isProduction || (cfg.provider === "smtp" && !cfg.hasSmtp)) {
        console.error(message);
        if (exitOnError) process.exit(1);
      } else {
        console.warn(message);
      }
    } else {
      console.warn(message);
    }
  } else {
    console.log(
      `[EMAIL_CONFIG] provider=${cfg.provider} from=${cfg.fromEmail} smtp=${cfg.smtpHost || "n/a"}:${cfg.smtpPort || "-"} logo=${cfg.logoUrl ? "configured" : "fallback-text"}`
    );
  }

  return { ok: issues.length === 0, issues, config: cfg };
}

/** Safe public snapshot for /health (no secrets) */
function getEmailHealthSnapshot() {
  const cfg = getEmailConfig();
  return {
    provider: cfg.provider,
    from: cfg.fromEmail,
    smtp_configured: cfg.hasSmtp,
    smtp_host: cfg.smtpHost || null,
    smtp_missing: cfg.smtpMissing || [],
    sandbox: cfg.provider === "sandbox",
    production_ready: cfg.isProduction
      ? cfg.provider !== "sandbox" && (cfg.hasSmtp || cfg.hasResend)
      : null,
  };
}

module.exports = {
  getEmailConfig,
  validateEmailEnv,
  getEmailHealthSnapshot,
  isProduction,
  smtpCredentialStatus,
};
