const { getEmailConfig } = require("../emailConfig");
const { BRAND, escapeHtml, renderEmailLayout, supportEmail } = require("./layout");

const PURPOSE_COPY = {
  EMAIL_VERIFICATION: {
    heading: "Verify Your Email",
    intro: "Use the verification code below to confirm your email address on Money Trend.",
  },
  LOGIN_VERIFICATION: {
    heading: "Login Verification",
    intro: "Use the verification code below to complete your Money Trend sign-in.",
  },
  PASSWORD_RESET: {
    heading: "Password Reset Code",
    intro: "Use the verification code below to reset your Money Trend password.",
  },
  CHANGE_EMAIL: {
    heading: "Confirm Email Change",
    intro: "Use the verification code below to confirm changing your Money Trend email.",
  },
  TRANSACTION_VERIFICATION: {
    heading: "Transaction Verification",
    intro: "Use the verification code below to authorize this Money Trend transaction.",
  },
};

function buildOtpEmail({ firstName, otp, purpose, expiresMinutes }) {
  const cfg = getEmailConfig();
  const copy = PURPOSE_COPY[purpose] || PURPOSE_COPY.EMAIL_VERIFICATION;
  const name = escapeHtml(firstName || "there");
  const minutes = Number(expiresMinutes || cfg.otpExpiryMinutes || 10);
  const otpDigits = escapeHtml(String(otp));
  const support = escapeHtml(supportEmail());

  const bodyHtml = `
    <p style="margin:0 0 8px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.green};">
      Hello ${name},
    </p>
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;line-height:1.3;color:${BRAND.green};">
      ${escapeHtml(copy.heading)}
    </h1>
    <p style="margin:0 0 16px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      ${escapeHtml(copy.intro)}
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
      <tr>
        <td align="center" style="padding:18px 12px;background:rgba(255,255,255,0.94);border:1px solid #E6D7B0;border-radius:12px;">
          <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.gold};margin-bottom:8px;">
            Verification code
          </div>
          <div style="font-family:Consolas,Monaco,monospace;font-size:32px;font-weight:700;letter-spacing:0.28em;color:${BRAND.green};">
            ${otpDigits}
          </div>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 6px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Expires in <strong style="color:${BRAND.green};">${minutes} minutes</strong>. Do not share this code.
    </p>
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Need help? <a href="mailto:${support}" style="color:${BRAND.green};">${support}</a>
    </p>
  `;

  return {
    subject: `Money Trend verification code`,
    html: renderEmailLayout({
      title: `${copy.heading} | ${cfg.appName || "Money Trend"}`,
      preheader: `Your Money Trend verification code expires in ${minutes} minutes.`,
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: [
      `Hello ${firstName || "there"},`,
      ``,
      `Your Money Trend verification code is: ${otp}`,
      ``,
      `This code will expire in ${minutes} minutes.`,
      ``,
      `If you did not request this verification code, please ignore this email.`,
      `Do not share this OTP with anyone.`,
      ``,
      `Need help? ${supportEmail()}`,
      `— Money Trend`,
    ].join("\n"),
  };
}

module.exports = {
  buildOtpEmail,
  PURPOSE_COPY,
};
