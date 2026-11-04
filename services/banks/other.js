const { fetchBankJson, normalizeBankPayload } = require("./http");
const { FALLBACK_BANK_RATES } = require("./fallbackRates");

/**
 * Other scheduled banks (PNB, BoB, Kotak, or any custom OTHER_BANK_API_URL).
 */
async function fetchOtherBankRates() {
  const otherUrl = process.env.OTHER_BANK_API_URL;
  const otherKey = process.env.OTHER_BANK_API_KEY;

  const defaults = [
    FALLBACK_BANK_RATES.pnb,
    FALLBACK_BANK_RATES.bob,
    FALLBACK_BANK_RATES.kotak,
  ];

  if (otherUrl) {
    try {
      const raw = await fetchBankJson(otherUrl, { apiKey: otherKey });
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw?.banks)
            ? raw.banks
            : [raw];

      return list.map((item, idx) => {
        const fb = defaults[idx] || defaults[0];
        return {
          ...normalizeBankPayload(item, fb),
          source: "other_bank_api",
          live: true,
        };
      });
    } catch (error) {
      console.warn("[BANK:OTHER] external API failed, using fallback:", error.message);
      return defaults.map((b) => ({
        ...b,
        source: "fallback",
        live: false,
        error: error.message,
      }));
    }
  }

  // Per-bank optional URLs
  const configured = [
    { code: "pnb", url: process.env.PNB_FD_API_URL, key: process.env.PNB_API_KEY },
    { code: "bob", url: process.env.BOB_FD_API_URL, key: process.env.BOB_API_KEY },
    { code: "kotak", url: process.env.KOTAK_FD_API_URL, key: process.env.KOTAK_API_KEY },
  ];

  const results = await Promise.all(
    configured.map(async ({ code, url, key }) => {
      const fallback = FALLBACK_BANK_RATES[code];
      if (!url) {
        return { ...fallback, source: "fallback", live: false };
      }
      try {
        const raw = await fetchBankJson(url, { apiKey: key });
        return {
          ...normalizeBankPayload(raw, fallback),
          source: `${code}_api`,
          live: true,
        };
      } catch (error) {
        console.warn(`[BANK:${code.toUpperCase()}] failed:`, error.message);
        return { ...fallback, source: "fallback", live: false, error: error.message };
      }
    })
  );

  return results;
}

module.exports = { fetchOtherBankRates };
