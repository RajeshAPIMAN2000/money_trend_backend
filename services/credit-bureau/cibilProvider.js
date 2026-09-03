const { fetchWithRetry } = require("./httpClient");
const { normalize } = require("./normalizer");
const { mockCibil, mockNoHit } = require("./mockResponses");

const name = "CIBIL";

async function fetchCreditReport(input) {
  const mode = process.env.CREDIT_CHECK_MODE || "sandbox";

  if (mode === "sandbox") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("CIBIL") : mockCibil(input);
    return normalize(name, raw);
  }

  // TODO: insert real endpoint & payload per bureau's API doc (TransUnion CIBIL)
  const baseUrl = process.env.CIBIL_API_BASE_URL;
  const apiKey = process.env.CIBIL_API_KEY;
  const clientId = process.env.CIBIL_CLIENT_ID;

  if (!baseUrl || !apiKey) {
    throw new Error("CIBIL API credentials not configured");
  }

  const payload = {
    pan: input.pan,
    name: input.fullName,
    dob: input.dob,
    mobile: input.mobile,
    address: input.address,
    consentRef: input.consentRef,
  };

  const raw = await fetchWithRetry(`${baseUrl}/v1/credit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Id": clientId || "",
    },
    body: JSON.stringify(payload),
  });

  return normalize(name, raw);
}

module.exports = { name, fetchCreditReport };
