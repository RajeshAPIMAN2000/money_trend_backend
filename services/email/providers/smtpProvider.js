const nodemailer = require("nodemailer");

function createSmtpProvider() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASS are required for SMTP provider");
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // GoDaddy / shared hosting often needs this
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") !== "false",
      minVersion: "TLSv1.2",
    },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 20000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 20000),
  });

  return {
    name: "smtp",
    async send({ from, to, subject, html, text, replyTo, attachments }) {
      try {
        const info = await transport.sendMail({
          from,
          to,
          subject,
          html,
          text,
          replyTo,
          attachments,
        });
        return {
          provider: "smtp",
          messageId: info.messageId || null,
          accepted: info.accepted || [],
          rejected: info.rejected || [],
          status: "sent",
        };
      } catch (error) {
        const err = new Error("EMAIL_SEND_FAILED");
        err.code = "EMAIL_SEND_FAILED";
        err.provider = "smtp";
        // Never include password; keep short SMTP response code/message only
        err.details = String(error.response || error.message || "")
          .replace(pass, "[REDACTED]")
          .slice(0, 200);
        console.error("[EMAIL][smtp] send failed", {
          host,
          port,
          secure,
          code: error.code || null,
          responseCode: error.responseCode || null,
          details: err.details,
        });
        throw err;
      }
    },
  };
}

module.exports = { createSmtpProvider };
