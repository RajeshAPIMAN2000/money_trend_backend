const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const { resolveUploadsDir } = require("../config/uploadsPath");

function supportInbox() {
  return String(process.env.SUPPORT_EMAIL || "info@moneytrend.in").trim();
}

function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      (process.env.SMTP_PASS || process.env.SMTP_PASSWORD)
  );
}

function createTransport() {
  if (!isSmtpConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
    },
  });
}

function absoluteAttachmentPath(relativeOrName) {
  if (!relativeOrName) return null;
  const name = String(relativeOrName).replace(/^\/?uploads\//, "");
  const full = path.join(resolveUploadsDir(), path.basename(name));
  return fs.existsSync(full) ? full : null;
}

/**
 * Send support ticket notification to info@moneytrend.in (or SUPPORT_EMAIL).
 * In sandbox / missing SMTP, logs the email instead of failing the ticket create.
 */
async function sendSupportTicketEmail({ ticket, user, attachmentPath }) {
  const to = supportInbox();
  const from =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    `"Money Trend Support" <noreply@moneytrend.in>`;

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
    ``,
    `Submitted at: ${ticket.created_at || new Date().toISOString()}`,
  ].join("\n");

  const html = `
    <h2>New support ticket #${ticket.id}</h2>
    <p><strong>Status:</strong> ${ticket.status}</p>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <p><strong>User:</strong> ${user?.full_name || "N/A"} &lt;${user?.email || "N/A"}&gt;</p>
    <p><strong>Phone:</strong> ${user?.phone || "N/A"}</p>
    <p><strong>User ID:</strong> ${ticket.user_id}</p>
    <hr/>
    <p><strong>Description</strong></p>
    <p style="white-space:pre-wrap">${String(ticket.description || "").replace(/</g, "&lt;")}</p>
    <p><strong>Attachment:</strong> ${attachmentPath || "none"}</p>
  `;

  const mail = {
    from,
    to,
    replyTo: user?.email || undefined,
    subject,
    text,
    html,
  };

  const filePath = absoluteAttachmentPath(attachmentPath);
  if (filePath) {
    mail.attachments = [
      {
        filename: path.basename(filePath),
        path: filePath,
      },
    ];
  }

  const transport = createTransport();
  if (!transport) {
    console.log("[EMAIL][sandbox] Support ticket mail (SMTP not configured):", {
      to,
      subject: mail.subject,
      text,
      attachment: filePath || null,
    });
    return { sent: false, mode: "sandbox", to };
  }

  const info = await transport.sendMail(mail);
  console.log("[EMAIL] Support ticket mailed:", { to, messageId: info.messageId, ticketId: ticket.id });
  return { sent: true, mode: "smtp", to, messageId: info.messageId };
}

async function sendSupportStatusEmail({ ticket, user }) {
  if (!user?.email) return { sent: false, reason: "no_user_email" };

  const from =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    `"Money Trend Support" <noreply@moneytrend.in>`;

  const statusLabel =
    ticket.status === "in_process"
      ? "In Process"
      : ticket.status === "fixed"
        ? "Fixed"
        : "Pending";

  const subject = `[Money Trend] Ticket #${ticket.id} is now ${statusLabel}`;
  const text = [
    `Hi ${user.full_name || "there"},`,
    ``,
    `Your support ticket #${ticket.id} (${ticket.subject}) status was updated to: ${statusLabel}.`,
    ticket.admin_note ? `\nAdmin note: ${ticket.admin_note}` : "",
    ``,
    `— Money Trend Support`,
  ].join("\n");

  const transport = createTransport();
  if (!transport) {
    console.log("[EMAIL][sandbox] Status update mail:", { to: user.email, subject, text });
    return { sent: false, mode: "sandbox", to: user.email };
  }

  const info = await transport.sendMail({
    from,
    to: user.email,
    subject,
    text,
  });
  return { sent: true, mode: "smtp", to: user.email, messageId: info.messageId };
}

module.exports = {
  supportInbox,
  sendSupportTicketEmail,
  sendSupportStatusEmail,
};
