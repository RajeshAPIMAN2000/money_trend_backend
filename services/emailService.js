const path = require("path");
const fs = require("fs");
const { resolveUploadsDir } = require("../config/uploadsPath");
const { getEmailConfig } = require("./email/emailConfig");
const { getEmailProvider } = require("./email/providers");
const { buildOtpEmail } = require("./email/templates/otpEmail");
const {
  buildKycVerifiedEmail,
  buildKycRejectedEmail,
  buildKycReminderEmail,
  buildKycSubmittedEmail,
} = require("./email/templates/kycEmails");
const { maskEmail, hashEmailForLog } = require("../utils/otpCrypto");

function supportInbox() {
  return getEmailConfig().supportEmail;
}

function absoluteAttachmentPath(relativeOrName) {
  if (!relativeOrName) return null;
  const name = String(relativeOrName).replace(/^\/?uploads\//, "");
  const full = path.join(resolveUploadsDir(), path.basename(name));
  return fs.existsSync(full) ? full : null;
}

function logEmailEvent({ emailType, to, result, error }) {
  const payload = {
    type: emailType || "generic",
    to_masked: maskEmail(to),
    to_hash: hashEmailForLog(to),
    provider: result?.provider || error?.provider || getEmailConfig().provider,
    messageId: result?.messageId || null,
    status: error ? "failed" : result?.status || "unknown",
    timestamp: new Date().toISOString(),
  };
  if (error) {
    payload.failure_reason = error.code || error.message || "EMAIL_SEND_FAILED";
    console.error("[EMAIL]", payload);
  } else {
    console.log("[EMAIL]", payload);
  }
}

/**
 * Provider-agnostic send. Controllers must not call Resend/SMTP directly.
 */
async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  attachments,
  emailType = "generic",
}) {
  const cfg = getEmailConfig();
  const provider = getEmailProvider();

  try {
    const result = await provider.send({
      from: cfg.fromHeader,
      to,
      subject,
      html,
      text,
      replyTo: replyTo || cfg.replyTo,
      attachments,
      emailType,
    });
    logEmailEvent({ emailType, to, result });
    return result;
  } catch (error) {
    const err = new Error("EMAIL_SEND_FAILED");
    err.code = "EMAIL_SEND_FAILED";
    err.provider = provider.name;
    logEmailEvent({ emailType, to, error: err });
    throw err;
  }
}

async function sendOtpEmail({ to, firstName, otp, purpose, expiresMinutes }) {
  const content = buildOtpEmail({ firstName, otp, purpose, expiresMinutes });
  return sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    emailType: `otp_${String(purpose || "EMAIL_VERIFICATION").toLowerCase()}`,
  });
}

async function sendKycVerifiedEmail({ to, firstName }) {
  const content = buildKycVerifiedEmail({ firstName });
  return sendEmail({ ...content, to, emailType: "kyc_verified" });
}

async function sendKycRejectedEmail({ to, firstName, reason }) {
  const content = buildKycRejectedEmail({ firstName, reason });
  return sendEmail({ ...content, to, emailType: "kyc_rejected" });
}

async function sendKycReminderEmail({ to, firstName }) {
  const content = buildKycReminderEmail({ firstName });
  return sendEmail({ ...content, to, emailType: "kyc_reminder" });
}

async function sendKycSubmittedEmail({ to, firstName }) {
  const content = buildKycSubmittedEmail({ firstName });
  return sendEmail({ ...content, to, emailType: "kyc_submitted" });
}

async function sendSupportTicketEmail({ ticket, user, attachmentPath }) {
  const to = supportInbox();
  const subject = `[Support #${ticket.id}] ${ticket.subject} — ${ticket.status}`;
  const text = [
    `New support ticket #${ticket.id}`,
    ``,
    `Status: ${ticket.status}`,
    `Subject: ${ticket.subject}`,
    `User: ${user?.full_name || "N/A"} (${user?.email || "N/A"})`,
    `Phone: ${user?.phone || "N/A"}`,
    `User ID: ${ticket.user_id}`,
    ``,
    `Description:`,
    ticket.description,
    ``,
    attachmentPath ? `Attachment: ${attachmentPath}` : `Attachment: none`,
  ].join("\n");

  const html = `
    <h2>New support ticket #${ticket.id}</h2>
    <p><strong>Status:</strong> ${ticket.status}</p>
    <p><strong>Subject:</strong> ${String(ticket.subject || "").replace(/</g, "&lt;")}</p>
    <p><strong>User:</strong> ${String(user?.full_name || "N/A").replace(/</g, "&lt;")} &lt;${String(user?.email || "N/A").replace(/</g, "&lt;")}&gt;</p>
    <p><strong>Phone:</strong> ${String(user?.phone || "N/A").replace(/</g, "&lt;")}</p>
    <hr/>
    <p style="white-space:pre-wrap">${String(ticket.description || "").replace(/</g, "&lt;")}</p>
  `;

  const attachments = [];
  const filePath = absoluteAttachmentPath(attachmentPath);
  if (filePath) {
    attachments.push({ filename: path.basename(filePath), path: filePath });
  }

  return sendEmail({
    to,
    subject,
    html,
    text,
    replyTo: user?.email || undefined,
    attachments: attachments.length ? attachments : undefined,
    emailType: "support_ticket",
  });
}

async function sendSupportStatusEmail({ ticket, user }) {
  if (!user?.email) return { sent: false, reason: "no_user_email" };

  const statusLabel =
    ticket.status === "in_process"
      ? "In Process"
      : ticket.status === "fixed"
        ? "Fixed"
        : "Pending";

  const subject = `[MoneyTrend] Ticket #${ticket.id} is now ${statusLabel}`;
  const text = [
    `Hi ${user.full_name || "there"},`,
    ``,
    `Your support ticket #${ticket.id} (${ticket.subject}) status was updated to: ${statusLabel}.`,
    ticket.admin_note ? `\nAdmin note: ${ticket.admin_note}` : "",
    ``,
    `— MoneyTrend Support`,
  ].join("\n");

  return sendEmail({
    to: user.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
    emailType: "support_status",
  });
}

module.exports = {
  supportInbox,
  sendEmail,
  sendOtpEmail,
  sendKycVerifiedEmail,
  sendKycRejectedEmail,
  sendKycReminderEmail,
  sendKycSubmittedEmail,
  sendSupportTicketEmail,
  sendSupportStatusEmail,
};
