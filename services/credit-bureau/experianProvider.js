const { fetchWithRetry } = require("./httpClient");
const { normalize } = require("./normalizer");
const { mockExperian, mockNoHit } = require("./mockResponses");

const name = "EXPERIAN";

async function fetchCreditReport(input) {
  const mode = process.env.CREDIT_CHECK_MODE || "sandbox";

  if (mode === "sandbox") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("EXPERIAN") : mockExperian(input);
    return normalize(name, raw);
  }

  // TODO: insert real endpoint & payload per bureau's API doc (Experian India)
  const baseUrl = process.env.EXPERIAN_API_BASE_URL;
  const apiKey = process.env.EXPERIAN_API_KEY;
  const clientSecret = process.env.EXPERIAN_CLIENT_SECRET;

  if (!baseUrl || !apiKey) {
    throw new Error("Experian API credentials not configured");
  }

  const payload = {
    PAN: input.pan,
    FirstName: input.fullName,
    DateOfBirth: input.dob,
    MobilePhone: input.mobile,
  };

  const raw = await fetchWithRetry(`${baseUrl}/consumerservices/credit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Auth-Token": apiKey,
      "Client-Secret": clientSecret || "",
    },
    body: JSON.stringify(payload),
  });

  return normalize(name, raw);
}

module.exports = { name, fetchCreditReport };
