const { getEmailConfig } = require("../emailConfig");
const { escapeHtml, renderEmailLayout } = require("./layout");

function buildKycVerifiedEmail({ firstName }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">KYC Verified Successfully</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hello ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      Great news — your KYC documents have been <strong style="color:#047857;">verified</strong> by the MoneyTrend team.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      You can now invest in Fixed Deposits and Recurring Deposits, manage your wallet, and track your portfolio securely.
    </p>
    <div style="margin:0;padding:14px 16px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;font-size:14px;color:#065f46;">
      Your account is ready for investments.
    </div>
  `;
  return {
    subject: `KYC verified — welcome to ${cfg.appName} investing`,
    html: renderEmailLayout({
      title: `KYC Verified | ${cfg.appName}`,
      preheader: "Your KYC is verified. You can start investing.",
      bodyHtml,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC has been verified successfully on ${cfg.appName}. You can now invest in FD/RD.\n\nNeed help? ${cfg.supportEmail}`,
  };
}

function buildKycRejectedEmail({ firstName, reason }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const reasonHtml = reason
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#7f1d1d;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>`
    : "";
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">KYC Update Required</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hello ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      We could not verify your KYC documents at this time. Please review your details and resubmit clear PAN and Aadhaar images.
    </p>
    ${reasonHtml}
    <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">
      Questions? Contact <a href="mailto:${escapeHtml(cfg.supportEmail)}" style="color:#0f766e;">${escapeHtml(cfg.supportEmail)}</a>.
    </p>
  `;
  return {
    subject: `Action needed — KYC could not be verified`,
    html: renderEmailLayout({
      title: `KYC Update | ${cfg.appName}`,
      preheader: "Your KYC needs attention. Please resubmit documents.",
      bodyHtml,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC could not be verified.${reason ? `\nReason: ${reason}` : ""}\n\nPlease resubmit clear documents.\nNeed help? ${cfg.supportEmail}`,
  };
}

function buildKycReminderEmail({ firstName }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">Complete Your KYC</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hello ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      Your MoneyTrend account is almost ready. Complete KYC with your PAN and Aadhaar to unlock FD/RD investments and withdrawals.
    </p>
    <div style="margin:0;padding:14px 16px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;font-size:14px;color:#9a3412;">
      Reminder: KYC is required before investing.
    </div>
  `;
  return {
    subject: `Reminder — complete your ${cfg.appName} KYC`,
    html: renderEmailLayout({
      title: `KYC Reminder | ${cfg.appName}`,
      preheader: "Complete KYC to start investing on MoneyTrend.",
      bodyHtml,
    }),
    text: `Hello ${firstName || "there"},\n\nPlease complete your KYC on ${cfg.appName} to unlock investments.\n\nNeed help? ${cfg.supportEmail}`,
  };
}

function buildKycSubmittedEmail({ firstName }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">KYC Submitted</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hello ${name},</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">
      We have received your KYC documents. Our team will review them shortly. You will get an email once verification is complete.
    </p>
  `;
  return {
    subject: `KYC received — under review`,
    html: renderEmailLayout({
      title: `KYC Submitted | ${cfg.appName}`,
      preheader: "Your KYC documents are under review.",
      bodyHtml,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC documents were received and are under review.\n\n— ${cfg.appName}`,
  };
}

module.exports = {
  buildKycVerifiedEmail,
  buildKycRejectedEmail,
  buildKycReminderEmail,
  buildKycSubmittedEmail,
};
