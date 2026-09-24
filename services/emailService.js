const path = require("path");
const fs = require("fs");
const { resolveUploadsDir } = require("../config/uploadsPath");
const { getEmailConfig } = require("./email/emailConfig");
const { getEmailProvider } = require("./email/providers");
const { buildBrandAttachments } = require("./email/templates/layout");
const { buildOtpEmail } = require("./email/templates/otpEmail");
const { buildWelcomeEmail } = require("./email/templates/welcomeEmail");
const {
  buildKycVerifiedEmail,
  buildKycRejectedEmail,
  buildKycReminderEmail,
  buildKycSubmittedEmail,
} = require("./email/templates/kycEmails");
const { maskEmail, hashEmailForLog } = require("../utils/otpCrypto");

function supportInbox() {
  return getEmailConfig().supportEmail || "info@moneytrend.in";
}

function absoluteAttachmentPath(relativeOrName) {
  if (!relativeOrName) return null;
  const name = String(relativeOrName).replace(/^\/?uploads\//, "");
  const full = path.join(resolveUploadsDir(), path.basename(name));
  return fs.existsSync(full) ? full : null;
}

function withBrandAssets(attachments = []) {
  const list = Array.isArray(attachments) ? [...attachments] : [];
  for (const asset of buildBrandAttachments()) {
    if (!list.some((a) => a.cid === asset.cid || a.filename === asset.filename)) {
      list.unshift(asset);
    }
  }
  return list.length ? list : undefined;
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
 * Always embeds Money Trend logo via CID so it shows in the template.
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
      replyTo: replyTo || cfg.replyTo || "info@moneytrend.in",
      attachments: withBrandAssets(attachments),
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

async function sendWelcomeEmail({ to, firstName, email, registeredAt }) {
  const content = buildWelcomeEmail({
    firstName,
    email: email || to,
    registeredAt,
  });
  return sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    emailType: "welcome",
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

  const { renderEmailLayout, BRAND, escapeHtml } = require("./email/templates/layout");
  const bodyHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.cream};">
      <tr>
        <td style="padding:28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
          <h2 style="margin:0 0 12px;font-family:Georgia,Times,serif;color:${BRAND.green};">New support ticket #${ticket.id}</h2>
          <p><strong>Status:</strong> ${escapeHtml(ticket.status)}</p>
          <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
          <p><strong>User:</strong> ${escapeHtml(user?.full_name || "N/A")} &lt;${escapeHtml(user?.email || "N/A")}&gt;</p>
          <p><strong>Phone:</strong> ${escapeHtml(user?.phone || "N/A")}</p>
          <hr style="border:none;border-top:1px solid #E6D7B0;margin:16px 0;" />
          <p style="white-space:pre-wrap">${escapeHtml(ticket.description || "")}</p>
        </td>
      </tr>
    </table>
  `;

  const attachments = [];
  const filePath = absoluteAttachmentPath(attachmentPath);
  if (filePath) {
    attachments.push({ filename: path.basename(filePath), path: filePath });
  }

  return sendEmail({
    to,
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `Support ticket #${ticket.id}`,
      bodyHtml,
    }),
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
        ? "Resolved"
        : "Pending";

  const subject = `[Money Trend] Ticket #${ticket.id} is now ${statusLabel}`;
  const text = [
    `Hi ${user.full_name || "there"},`,
    ``,
    `Your support ticket #${ticket.id} (${ticket.subject}) status was updated to: ${statusLabel}.`,
    ticket.admin_note ? `\nSupport reply: ${ticket.admin_note}` : "",
    ``,
    `— Money Trend Support (${supportInbox()})`,
  ].join("\n");

  const { renderEmailLayout, BRAND, escapeHtml } = require("./email/templates/layout");
  const bodyHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.cream};">
      <tr>
        <td style="padding:28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
          <h2 style="margin:0 0 12px;font-family:Georgia,Times,serif;color:${BRAND.green};">Ticket update</h2>
          <p>Hi ${escapeHtml(user.full_name || "there")},</p>
          <p>Your support ticket <strong>#${ticket.id}</strong> (${escapeHtml(ticket.subject)}) is now <strong>${escapeHtml(statusLabel)}</strong>.</p>
          ${
            ticket.admin_note
              ? `<p><strong>Support reply:</strong></p><p style="white-space:pre-wrap">${escapeHtml(ticket.admin_note)}</p>`
              : ""
          }
        </td>
      </tr>
    </table>
  `;

  return sendEmail({
    to: user.email,
    subject,
    text,
    html: renderEmailLayout({
      title: subject,
      preheader: `Ticket #${ticket.id} is ${statusLabel}`,
      bodyHtml,
    }),
    emailType: "support_status",
  });
}

async function sendSupportReplyEmail({ ticket, user, reply }) {
  if (!user?.email) return { sent: false, reason: "no_user_email" };

  const statusLabel =
    ticket.status === "in_process"
      ? "In Process"
      : ticket.status === "fixed"
        ? "Resolved"
        : "Pending";

  const replyText = String(reply || ticket.admin_note || "").trim();
  const subject = `[Money Trend] Reply on your ticket #${ticket.id}`;
  const text = [
    `Hi ${user.full_name || "there"},`,
    ``,
    `Our support team replied to your ticket #${ticket.id} (${ticket.subject}).`,
    `Current stage: ${statusLabel}`,
    ``,
    `Support guidance:`,
    replyText,
    ``,
    `— Money Trend Support (${supportInbox()})`,
  ].join("\n");

  const { renderEmailLayout, BRAND, escapeHtml } = require("./email/templates/layout");
  const bodyHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.cream};">
      <tr>
        <td style="padding:28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
          <h2 style="margin:0 0 12px;font-family:Georgia,Times,serif;color:${BRAND.green};">Support reply</h2>
          <p>Hi ${escapeHtml(user.full_name || "there")},</p>
          <p>Our support team replied to your ticket <strong>#${ticket.id}</strong> (${escapeHtml(
            ticket.subject || ""
          )}).</p>
          <p><strong>Current stage:</strong> ${escapeHtml(statusLabel)}</p>
          <hr style="border:none;border-top:1px solid #E6D7B0;margin:16px 0;" />
          <p><strong>Support guidance:</strong></p>
          <p style="white-space:pre-wrap">${escapeHtml(replyText)}</p>
        </td>
      </tr>
    </table>
  `;

  return sendEmail({
    to: user.email,
    subject,
    text,
    html: renderEmailLayout({
      title: subject,
      preheader: `Reply on ticket #${ticket.id}`,
      bodyHtml,
    }),
    emailType: "support_reply",
  });
}

async function sendSupportAssignedEmail({ ticket, user, agent }) {
  if (!user?.email) return { sent: false, reason: "no_user_email" };

  const agentName = agent?.full_name || "our support team";
  const subject = `[Money Trend] Support agent assigned to ticket #${ticket.id}`;
  const text = [
    `Hi ${user.full_name || "there"},`,
    ``,
    `Your support ticket #${ticket.id} (${ticket.subject}) has been assigned to ${agentName}.`,
    `They will guide you until your issue is resolved.`,
    ``,
    `— Money Trend Support (${supportInbox()})`,
  ].join("\n");

  const { renderEmailLayout, BRAND, escapeHtml } = require("./email/templates/layout");
  const bodyHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.cream};">
      <tr>
        <td style="padding:28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
          <h2 style="margin:0 0 12px;font-family:Georgia,Times,serif;color:${BRAND.green};">Support agent assigned</h2>
          <p>Hi ${escapeHtml(user.full_name || "there")},</p>
          <p>Your support ticket <strong>#${ticket.id}</strong> (${escapeHtml(
            ticket.subject || ""
          )}) has been assigned to <strong>${escapeHtml(agentName)}</strong>.</p>
          <p>They will guide you until your issue is resolved.</p>
        </td>
      </tr>
    </table>
  `;

  return sendEmail({
    to: user.email,
    subject,
    text,
    html: renderEmailLayout({
      title: subject,
      preheader: `Agent assigned to ticket #${ticket.id}`,
      bodyHtml,
    }),
    emailType: "support_assigned",
  });
}

module.exports = {
  supportInbox,
  sendEmail,
  sendOtpEmail,
  sendWelcomeEmail,
  sendKycVerifiedEmail,
  sendKycRejectedEmail,
  sendKycReminderEmail,
  sendKycSubmittedEmail,
  sendSupportTicketEmail,
  sendSupportStatusEmail,
  sendSupportReplyEmail,
  sendSupportAssignedEmail,
};
