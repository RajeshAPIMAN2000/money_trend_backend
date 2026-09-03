const { fetchWithRetry } = require("./httpClient");
const { normalize } = require("./normalizer");
const { mockEquifax, mockNoHit } = require("./mockResponses");

const name = "EQUIFAX";

async function fetchCreditReport(input) {
  const mode = process.env.CREDIT_CHECK_MODE || "sandbox";

  if (mode === "sandbox") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("EQUIFAX") : mockEquifax(input);
    return normalize(name, raw);
  }

  // TODO: insert real endpoint & payload per bureau's API doc (Equifax India)
  const baseUrl = process.env.EQUIFAX_API_BASE_URL;
  const apiKey = process.env.EQUIFAX_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("Equifax API credentials not configured");
  }

  const payload = {
    applicant: {
      pan: input.pan,
      fullName: input.fullName,
      dateOfBirth: input.dob,
      phoneNumber: input.mobile,
    },
  };

  const raw = await fetchWithRetry(`${baseUrl}/credit/score/v1/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Efx-Api-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  return normalize(name, raw);
}

module.exports = { name, fetchCreditReport };
