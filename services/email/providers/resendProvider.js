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
        payload.attachments = await Promise.all(
          attachments.map(async (a) => {
            const item = {
              filename: a.filename,
            };
            if (a.content) {
              item.content = Buffer.isBuffer(a.content)
                ? a.content.toString("base64")
                : a.content;
            } else if (a.path) {
              const fs = require("fs");
              item.content = fs.readFileSync(a.path).toString("base64");
            }
            if (a.cid) {
              item.content_id = a.cid;
              item.contentId = a.cid;
            }
            return item;
          })
        );
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
