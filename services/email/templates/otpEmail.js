const { getEmailConfig } = require("../emailConfig");
const { escapeHtml, renderEmailLayout } = require("./layout");

const PURPOSE_COPY = {
  EMAIL_VERIFICATION: {
    heading: "Verify Your Email",
    intro: "Use the verification code below to confirm your email address on MoneyTrend.",
  },
  LOGIN_VERIFICATION: {
    heading: "Login Verification",
    intro: "Use the verification code below to complete your MoneyTrend sign-in.",
  },
  PASSWORD_RESET: {
    heading: "Password Reset Code",
    intro: "Use the verification code below to reset your MoneyTrend password.",
  },
  CHANGE_EMAIL: {
    heading: "Confirm Email Change",
    intro: "Use the verification code below to confirm changing your MoneyTrend email.",
  },
  TRANSACTION_VERIFICATION: {
    heading: "Transaction Verification",
    intro: "Use the verification code below to authorize this MoneyTrend transaction.",
  },
};

function buildOtpEmail({ firstName, otp, purpose, expiresMinutes }) {
  const cfg = getEmailConfig();
  const copy = PURPOSE_COPY[purpose] || PURPOSE_COPY.EMAIL_VERIFICATION;
  const name = escapeHtml(firstName || "there");
  const minutes = Number(expiresMinutes || cfg.otpExpiryMinutes || 10);
  const otpDigits = escapeHtml(String(otp));

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">${escapeHtml(copy.heading)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">Hello ${name},</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(copy.intro)}</p>
    <div style="margin:0 0 22px;padding:18px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0;text-align:center;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#047857;margin-bottom:8px;">Verification code</div>
      <div style="font-size:32px;font-weight:700;letter-spacing:0.28em;color:#065f46;font-family:Consolas,Monaco,monospace;">${otpDigits}</div>
    </div>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#475569;">This code will expire in <strong>${minutes} minutes</strong>.</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#475569;">If you did not request this verification code, please ignore this email.</p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#b45309;"><strong>Security tip:</strong> Do not share this OTP with anyone. MoneyTrend will never ask for your OTP by phone or chat.</p>
  `;

  const html = renderEmailLayout({
    title: `${copy.heading} | ${cfg.appName}`,
    preheader: `Your ${cfg.appName} verification code expires in ${minutes} minutes.`,
    bodyHtml,
  });

  const text = [
    `Hello ${firstName || "there"},`,
    ``,
    `Your ${cfg.appName} verification code is: ${otp}`,
    ``,
    `This code will expire in ${minutes} minutes.`,
    ``,
    `If you did not request this verification code, please ignore this email.`,
    `Do not share this OTP with anyone.`,
    ``,
    `Need help? ${cfg.supportEmail}`,
    `— ${cfg.appName}`,
  ].join("\n");

  return {
    subject: `${cfg.appName} verification code`,
    html,
    text,
  };
}

module.exports = {
  buildOtpEmail,
  PURPOSE_COPY,
};
