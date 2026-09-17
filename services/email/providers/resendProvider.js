const { Resend } = require("resend");

function createResendProvider() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required for Resend provider");
  }

  const client = new Resend(apiKey);

  return {
    name: "resend",
    async send({ from, to, subject, html, text, replyTo, attachments }) {
      const payload = {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
      };
      if (replyTo) payload.replyTo = replyTo;
      if (attachments?.length) {
        payload.attachments = attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          path: a.path,
        }));
      }

      const { data, error } = await client.emails.send(payload);
      if (error) {
        const err = new Error(error.message || "Resend send failed");
        err.code = "EMAIL_SEND_FAILED";
        err.provider = "resend";
        throw err;
      }

      return {
        provider: "resend",
        messageId: data?.id || null,
        status: "sent",
      };
    },
  };
}

module.exports = { createResendProvider };
