const SMS_MODE = String(process.env.SMS_MODE || "sandbox").toLowerCase();

function formatPhoneE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return digits;
  return digits;
}

async function sendViaMsg91(phone, message) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const senderId = process.env.MSG91_SENDER_ID || "MNYTRD";
  if (!authKey) {
    throw new Error("MSG91_AUTH_KEY is not configured");
  }

  const mobile = formatPhoneE164(phone);
  const url = new URL("https://control.msg91.com/api/sendhttp.php");
  url.searchParams.set("authkey", authKey);
  url.searchParams.set("mobiles", mobile);
  url.searchParams.set("message", message);
  url.searchParams.set("sender", senderId);
  url.searchParams.set("route", "4");
  url.searchParams.set("country", "91");

  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MSG91 SMS failed: ${text || res.status}`);
  }
  return { provider: "msg91", response: text };
}

async function sendViaTwilio(phone, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio SMS credentials are not configured");
  }

  const mobile = formatPhoneE164(phone);
  const to = mobile.startsWith("+") ? mobile : `+${mobile}`;
  const body = new URLSearchParams({ To: to, From: from, Body: message });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Twilio SMS failed: ${res.status}`);
  }
  return { provider: "twilio", sid: data.sid };
}

async function sendSms(phone, message) {
  if (SMS_MODE === "msg91") {
    return sendViaMsg91(phone, message);
  }
  if (SMS_MODE === "twilio") {
    return sendViaTwilio(phone, message);
  }

  console.log(`[SMS:sandbox] To ${phone}: ${message}`);
  return { provider: "sandbox", delivered: true };
}

module.exports = {
  SMS_MODE,
  formatPhoneE164,
  sendSms,
};
