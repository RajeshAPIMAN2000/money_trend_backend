const { loadEnv } = require("../config/loadEnv");

loadEnv();

const required = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DB_NAME"];
const warnings = [];
const errors = [];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

if (isProd) {
  if (!process.env.DB_PASSWORD) warnings.push("DB_PASSWORD is empty");
  if ((process.env.JWT_ACCESS_SECRET || "").includes("dev_")) {
    warnings.push("JWT_ACCESS_SECRET looks like a dev value");
  }
  if (process.env.CORS_ORIGIN === "*") warnings.push("CORS_ORIGIN=* in production is insecure");

  const provider = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
  const hasSmtp =
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    (process.env.SMTP_PASS || process.env.SMTP_PASSWORD);
  const hasResend = Boolean(process.env.RESEND_API_KEY);

  if (provider === "sandbox" || (!provider && !hasSmtp && !hasResend)) {
    errors.push(
      "Production email cannot use sandbox. Set EMAIL_PROVIDER=smtp + SMTP_HOST=smtp.hostinger.com + SMTP_USER + SMTP_PASS"
    );
  }
  if ((provider === "smtp" || !provider) && !hasSmtp && !hasResend) {
    errors.push("SMTP_HOST / SMTP_USER / SMTP_PASS are required on Hostinger VPS");
  }
  if (!process.env.PUBLIC_BASE_URL && !process.env.MAIL_LOGO_URL) {
    warnings.push("Set PUBLIC_BASE_URL or MAIL_LOGO_URL for email branding");
  }
}

if (errors.length) {
  console.error("Errors (fix before deploy):");
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

if (warnings.length) {
  console.warn("Warnings:");
  warnings.forEach((w) => console.warn(`  - ${w}`));
}

console.log(
  `OK  NODE_ENV=${process.env.NODE_ENV || "development"}  PORT=${process.env.PORT || 4000}  EMAIL_PROVIDER=${process.env.EMAIL_PROVIDER || "(auto)"}`
);
