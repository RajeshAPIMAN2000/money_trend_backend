const { BRAND, escapeHtml, renderEmailLayout, supportEmail } = require("./layout");

function buildKycVerifiedEmail({ firstName }) {
  const name = escapeHtml(firstName || "there");
  const support = escapeHtml(supportEmail());
  const bodyHtml = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;color:${BRAND.green};">KYC Verified Successfully</h1>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">Hello ${name},</p>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      Great news — your KYC documents have been <strong style="color:${BRAND.green};">verified</strong>. You can now invest in FD/RD and manage your wallet securely.
    </p>
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Need help? <a href="mailto:${support}" style="color:${BRAND.green};">${support}</a>
    </p>
  `;
  return {
    subject: `KYC verified — welcome to Money Trend investing`,
    html: renderEmailLayout({
      title: `KYC Verified | Money Trend`,
      preheader: "Your KYC is verified. You can start investing.",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC has been verified successfully on Money Trend. You can now invest in FD/RD.\n\nNeed help? ${supportEmail()}`,
  };
}

function buildKycRejectedEmail({ firstName, reason }) {
  const name = escapeHtml(firstName || "there");
  const support = escapeHtml(supportEmail());
  const reasonHtml = reason
    ? `<p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#7f1d1d;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>`
    : "";
  const bodyHtml = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;color:${BRAND.green};">KYC Update Required</h1>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">Hello ${name},</p>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      We could not verify your KYC documents. Please resubmit clear PAN and Aadhaar images.
    </p>
    ${reasonHtml}
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Questions? <a href="mailto:${support}" style="color:${BRAND.green};">${support}</a>
    </p>
  `;
  return {
    subject: `Action needed — KYC could not be verified`,
    html: renderEmailLayout({
      title: `KYC Update | Money Trend`,
      preheader: "Your KYC needs attention. Please resubmit documents.",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC could not be verified.${reason ? `\nReason: ${reason}` : ""}\n\nPlease resubmit clear documents.\nNeed help? ${supportEmail()}`,
  };
}

function buildKycReminderEmail({ firstName }) {
  const name = escapeHtml(firstName || "there");
  const support = escapeHtml(supportEmail());
  const bodyHtml = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;color:${BRAND.green};">Complete Your KYC</h1>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">Hello ${name},</p>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      Your Money Trend account is almost ready. Complete KYC with PAN and Aadhaar to unlock FD/RD investments.
    </p>
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Need help? <a href="mailto:${support}" style="color:${BRAND.green};">${support}</a>
    </p>
  `;
  return {
    subject: `Reminder — complete your Money Trend KYC`,
    html: renderEmailLayout({
      title: `KYC Reminder | Money Trend`,
      preheader: "Complete KYC to start investing on Money Trend.",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: `Hello ${firstName || "there"},\n\nPlease complete your KYC on Money Trend to unlock investments.\n\nNeed help? ${supportEmail()}`,
  };
}

function buildKycSubmittedEmail({ firstName }) {
  const name = escapeHtml(firstName || "there");
  const support = escapeHtml(supportEmail());
  const bodyHtml = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;color:${BRAND.green};">KYC Submitted</h1>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">Hello ${name},</p>
    <p style="margin:0 0 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      We have received your KYC documents. Our team will review them shortly.
    </p>
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Need help? <a href="mailto:${support}" style="color:${BRAND.green};">${support}</a>
    </p>
  `;
  return {
    subject: `KYC received — under review`,
    html: renderEmailLayout({
      title: `KYC Submitted | Money Trend`,
      preheader: "Your KYC documents are under review.",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: `Hello ${firstName || "there"},\n\nYour KYC documents were received and are under review.\n\n— Money Trend`,
  };
}

module.exports = {
  buildKycVerifiedEmail,
  buildKycRejectedEmail,
  buildKycReminderEmail,
  buildKycSubmittedEmail,
};
