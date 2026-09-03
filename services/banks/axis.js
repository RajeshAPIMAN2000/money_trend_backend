const { fetchBankJson, normalizeBankPayload } = require("./http");
const { FALLBACK_BANK_RATES } = require("./fallbackRates");

async function fetchAxisRates() {
  const fallback = FALLBACK_BANK_RATES.axis;
  const url = process.env.AXIS_FD_API_URL || process.env.AXIS_API_URL;
  const apiKey = process.env.AXIS_API_KEY;

  try {
    const raw = await fetchBankJson(url, { apiKey });
    return {
      ...normalizeBankPayload(raw, fallback),
      source: "axis_api",
      live: true,
    };
  } catch (error) {
    console.warn("[BANK:AXIS] external API failed, using fallback:", error.message);
    return { ...fallback, source: "fallback", live: false, error: error.message };
  }
}

module.exports = { fetchAxisRates };
