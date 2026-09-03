const { fetchBankJson, normalizeBankPayload } = require("./http");
const { FALLBACK_BANK_RATES } = require("./fallbackRates");

async function fetchHdfcRates() {
  const fallback = FALLBACK_BANK_RATES.hdfc;
  const url = process.env.HDFC_FD_API_URL || process.env.HDFC_API_URL;
  const apiKey = process.env.HDFC_API_KEY;

  try {
    const raw = await fetchBankJson(url, { apiKey });
    return {
      ...normalizeBankPayload(raw, fallback),
      source: "hdfc_api",
      live: true,
    };
  } catch (error) {
    console.warn("[BANK:HDFC] external API failed, using fallback:", error.message);
    return { ...fallback, source: "fallback", live: false, error: error.message };
  }
}

module.exports = { fetchHdfcRates };
