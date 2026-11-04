const { fetchBankJson, normalizeBankPayload } = require("./http");
const { FALLBACK_BANK_RATES } = require("./fallbackRates");

async function fetchIciciRates() {
  const fallback = FALLBACK_BANK_RATES.icici;
  const url = process.env.ICICI_FD_API_URL || process.env.ICICI_API_URL;
  const apiKey = process.env.ICICI_API_KEY;

  try {
    const raw = await fetchBankJson(url, { apiKey });
    return {
      ...normalizeBankPayload(raw, fallback),
      source: "icici_api",
      live: true,
    };
  } catch (error) {
    console.warn("[BANK:ICICI] external API failed, using fallback:", error.message);
    return { ...fallback, source: "fallback", live: false, error: error.message };
  }
}

module.exports = { fetchIciciRates };
