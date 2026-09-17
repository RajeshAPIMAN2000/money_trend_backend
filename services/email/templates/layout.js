const { getEmailConfig } = require("../emailConfig");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEmailLayout({ title, preheader, bodyHtml }) {
  const cfg = getEmailConfig();
  const brand = escapeHtml(cfg.appName || "MoneyTrend");
  const support = escapeHtml(cfg.supportEmail);
  const logoUrl = cfg.logoUrl;

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${brand}" width="160" style="display:block;max-width:160px;height:auto;border:0;" />`
    : `<div style="font-size:22px;font-weight:700;color:#0f766e;letter-spacing:0.02em;">${brand}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || "")}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:28px 28px 16px;border-bottom:1px solid #eef2f7;">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;background:#f8fafc;border-top:1px solid #eef2f7;font-size:12px;line-height:1.6;color:#64748b;">
              <strong style="color:#334155;">${brand}</strong> — Secure investing for FD &amp; RD<br/>
              Need help? Contact <a href="mailto:${support}" style="color:#0f766e;text-decoration:none;">${support}</a><br/>
              This is a transactional message from ${brand}. Please do not reply with sensitive information.
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} ${brand}. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderEmailLayout,
};
