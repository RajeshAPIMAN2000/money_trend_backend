const { fetchWithRetry } = require("./httpClient");
const { normalize } = require("./normalizer");
const { mockExperian, mockNoHit } = require("./mockResponses");
const {
  resolveExperianEnv,
  getExperianCreditCheckUrl,
  isExperianLiveMode,
} = require("./experianConfig");
const {
  getValidExperianToken,
  invalidateExperianToken,
} = require("./experianAuth");
const { buildExperianCreditCheckRequestBody } = require("./experianRequestBuilder");

const name = "EXPERIAN";

function buildAuthHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `${token.tokenType || "Bearer"} ${token.accessToken}`,
  };
}

/**
 * Live Experian India credit-check call.
 * Endpoint + request body come from env / configuration points — not invented here.
 */
async function fetchLiveExperianReport(input) {
  const url = getExperianCreditCheckUrl();
  const body = buildExperianCreditCheckRequestBody(input);
  const token = await getValidExperianToken();
  const started = Date.now();

  const raw = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: JSON.stringify(body),
    },
    {
      onUnauthorized: async () => {
        invalidateExperianToken();
        const fresh = await getValidExperianToken();
        return { headers: buildAuthHeaders(fresh) };
      },
    }
  );

  console.log(
    `[EXPERIAN] credit-check env=${resolveExperianEnv()} durationMs=${Date.now() - started} ok=true`
  );

  return normalize(name, raw);
}

async function fetchCreditReport(input) {
  // Sandbox mock mode (default) — no external Experian calls.
  if (!isExperianLiveMode()) {
    const raw =
      input.simulateNoHit === true ? mockNoHit("EXPERIAN") : mockExperian(input);
    return normalize(name, raw);
  }

  try {
    return await fetchLiveExperianReport(input);
  } catch (error) {
    // Safe structured log — no PAN/DOB/tokens.
    console.error(
      `[EXPERIAN] credit-check failed code=${error.code || "UNKNOWN"} status=${error.status || "-"} message=${error.message}`
    );
    throw error;
  }
}

module.exports = {
  name,
  fetchCreditReport,
  fetchLiveExperianReport,
};
