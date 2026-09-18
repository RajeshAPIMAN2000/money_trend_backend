const { getEmailConfig } = require("../emailConfig");
const {
  BRAND,
  escapeHtml,
  renderEmailLayout,
  loginUrl,
  supportEmail,
} = require("./layout");

function formatRegDate(date = new Date()) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildWelcomeEmail({ firstName, email, registeredAt }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const safeEmail = escapeHtml(email || "");
  const dateLabel = escapeHtml(formatRegDate(registeredAt ? new Date(registeredAt) : new Date()));
  const cta = loginUrl();

  // Minimal copy only — artboard (background-image.png) supplies all chrome/icons.
  const bodyHtml = `
    <p style="margin:0 0 8px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.green};">
      Hello ${name},
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;line-height:1.25;font-weight:700;">
      <span style="color:${BRAND.green};">Welcome to </span><span style="color:${BRAND.gold};">Money Trend!</span>
    </h1>
    <p style="margin:0 0 16px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:${BRAND.text};">
      Thank you for joining Money Trend. You’re one step closer to a smarter, more secure financial future.
      Explore investments, track goals, and make informed decisions — all in one place.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 14px;">
      <tr>
        <td style="padding:14px 16px;background:rgba(255,255,255,0.92);border:1px solid #E6D7B0;border-radius:12px;">
          <div style="font-family:Georgia,'Times New Roman',Times,serif;font-size:15px;color:${BRAND.green};font-weight:700;margin-bottom:8px;">
            ✓ Your account has been successfully created!
          </div>
          <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:${BRAND.muted};">
            <strong style="color:${BRAND.text};">Registered Email</strong> : ${safeEmail}<br/>
            <strong style="color:${BRAND.text};">Registration Date</strong> : ${dateLabel}
          </div>
        </td>
      </tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
      <tr>
        <td align="center" style="border-radius:999px;background:${BRAND.gold};">
          <a href="${escapeHtml(cta)}"
             style="display:inline-block;padding:12px 26px;border-radius:999px;background:${BRAND.gold};color:${BRAND.green};text-decoration:none;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;">
            Login to Your Account →
          </a>
        </td>
      </tr>
    </table>
  `;

  return {
    subject: `Welcome to ${cfg.appName || "Money Trend"} — your account is ready`,
    html: renderEmailLayout({
      title: `Welcome | ${cfg.appName || "Money Trend"}`,
      preheader: "Your Money Trend account has been created successfully.",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: [
      `Hello ${firstName || "there"},`,
      ``,
      `Welcome to Money Trend! Your account has been created successfully.`,
      `Registered email: ${email}`,
      `Registration date: ${formatRegDate(registeredAt ? new Date(registeredAt) : new Date())}`,
      ``,
      `Login: ${cta}`,
      ``,
      `Need help? ${supportEmail()}`,
      `— Money Trend`,
    ].join("\n"),
  };
}

module.exports = {
  buildWelcomeEmail,
};
