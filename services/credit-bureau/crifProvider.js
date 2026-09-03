const { fetchWithRetry } = require("./httpClient");
const { normalize } = require("./normalizer");
const { mockCrif, mockNoHit } = require("./mockResponses");

const name = "CRIF";

async function fetchCreditReport(input) {
  const mode = process.env.CREDIT_CHECK_MODE || "sandbox";

  if (mode === "sandbox") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("CRIF") : mockCrif(input);
    return normalize(name, raw);
  }

  // TODO: insert real endpoint & payload per bureau's API doc (CRIF High Mark)
  const baseUrl = process.env.CRIF_API_BASE_URL;
  const apiKey = process.env.CRIF_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("CRIF API credentials not configured");
  }

  const payload = {
    PAN: input.pan,
    ApplicantName: input.fullName,
    DOB: input.dob,
    MobileNo: input.mobile,
    AadhaarLast4: input.aadhaarLast4,
  };

  const raw = await fetchWithRetry(`${baseUrl}/api/v2/credit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(payload),
  });

  return normalize(name, raw);
}

module.exports = { name, fetchCreditReport };
