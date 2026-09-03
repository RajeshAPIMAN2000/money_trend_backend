/**
 * Aggregates FD/RD rates from bank external APIs in parallel.
 *
 * Node.js Backend
 *   ├── SBI API
 *   ├── HDFC API
 *   ├── ICICI API
 *   ├── Axis API
 *   └── Other Bank APIs
 *
 * Set *_FD_API_URL / *_API_KEY in .env to enable live bank feeds.
 * When an API is missing/unavailable, that bank falls back to RBI-aligned indicative rates.
 */
const { fetchSbiRates } = require("./sbi");
const { fetchHdfcRates } = require("./hdfc");
const { fetchIciciRates } = require("./icici");
const { fetchAxisRates } = require("./axis");
const { fetchOtherBankRates } = require("./other");

async function fetchAllBankRates() {
  const [sbi, hdfc, icici, axis, others] = await Promise.all([
    fetchSbiRates(),
    fetchHdfcRates(),
    fetchIciciRates(),
    fetchAxisRates(),
    fetchOtherBankRates(),
  ]);

  const banks = [sbi, hdfc, icici, axis, ...(Array.isArray(others) ? others : [others])];

  const fd_rates = banks.map((b) => ({
    bank_code: b.bank_code,
    bank: b.bank,
    type: b.type,
    rates: b.fd,
    senior_citizen_extra: b.senior_citizen_extra,
    source: b.source,
    live: Boolean(b.live),
  }));

  const rd_rates = banks.map((b) => ({
    bank_code: b.bank_code,
    bank: b.bank,
    type: b.type,
    rates: b.rd,
    senior_citizen_extra: b.senior_citizen_extra,
    source: b.source,
    live: Boolean(b.live),
  }));

  const liveCount = banks.filter((b) => b.live).length;

  return {
    banks,
    fd_rates,
    rd_rates,
    meta: {
      total_banks: banks.length,
      live_banks: liveCount,
      fallback_banks: banks.length - liveCount,
      fetched_at: new Date().toISOString(),
    },
  };
}

module.exports = { fetchAllBankRates };
