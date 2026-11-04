const nodemailer = require("nodemailer");

function buildTransportOptions() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASS are required for SMTP provider");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    // Hostinger + GoDaddy shared SMTP
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") !== "false",
      minVersion: "TLSv1.2",
    },
    requireTLS: !secure && port === 587,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 25000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 25000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 30000),
  };
}

function createSmtpProvider() {
  const options = buildTransportOptions();
  const pass = String(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
  const transport = nodemailer.createTransport(options);

  return {
    name: "smtp",
    async verify() {
      await transport.verify();
      return {
        ok: true,
        host: options.host,
        port: options.port,
        secure: options.secure,
      };
    },
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
        err.details = String(error.response || error.message || "")
          .replace(pass, "[REDACTED]")
          .slice(0, 200);
        console.error("[EMAIL][smtp] send failed", {
          host: options.host,
          port: options.port,
          secure: options.secure,
          code: error.code || null,
          responseCode: error.responseCode || null,
          details: err.details,
        });
        throw err;
      }
    },
  };
}

module.exports = { createSmtpProvider, buildTransportOptions };
