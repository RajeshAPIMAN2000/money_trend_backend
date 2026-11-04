/**
 * Maps bank adapter output (services/banks) into flat FD/RD rate records
 * for persistence and ticker APIs.
 */
const { fetchAllBankRates } = require("./banks");

function parseTenureKey(key) {
  const label = String(key || "").trim();
  const lower = label.toLowerCase();

  if (lower.includes("day")) {
    const range = lower.match(/(\d+)\s*-\s*(\d+)\s*_?\s*days/);
    if (range) {
      return { tenure: Number(range[2]), tenureUnit: "days", tenureLabel: label };
    }
    const single = lower.match(/(\d+)\s*_?\s*days/);
    if (single) {
      return { tenure: Number(single[1]), tenureUnit: "days", tenureLabel: label };
    }
  }

  if (lower.includes("month")) {
    const m = lower.match(/(\d+)/);
    return {
      tenure: m ? Number(m[1]) : 12,
      tenureUnit: "months",
      tenureLabel: label,
    };
  }

  if (lower.includes("year")) {
    const m = lower.match(/(\d+)/);
    return {
      tenure: m ? Number(m[1]) : 1,
      tenureUnit: "years",
      tenureLabel: label,
    };
  }

  return { tenure: 1, tenureUnit: "years", tenureLabel: label || "1_year" };
}

function formatTenureDisplay(tenure, tenureUnit) {
  const n = Number(tenure);
  const unit = String(tenureUnit || "years");
  if (unit === "days") return n === 1 ? "1 day" : `${n} days`;
  if (unit === "months") return n === 1 ? "1 month" : `${n} months`;
  return n === 1 ? "1 year" : `${n} years`;
}

function flattenProductRates(bank, productType, ratesObj, source, effectiveDate) {
  const records = [];
  const seniorExtra = Number(bank.senior_citizen_extra || 0);
  const entries = Object.entries(ratesObj || {});

  for (const [tenureKey, rateValue] of entries) {
    const baseRate = Number(rateValue);
    if (Number.isNaN(baseRate) || baseRate <= 0) continue;

    const { tenure, tenureUnit, tenureLabel } = parseTenureKey(tenureKey);

    records.push({
      bankName: bank.bank,
      bankCode: bank.bank_code,
      productType,
      interestRate: baseRate,
      tenure,
      tenureUnit,
      tenureLabel,
      minDeposit: null,
      maxDeposit: null,
      customerCategory: "regular",
      seniorCitizenExtra: seniorExtra || null,
      effectiveDate,
      expiryDate: null,
      status: "active",
      source,
    });

    if (seniorExtra > 0) {
      records.push({
        bankName: bank.bank,
        bankCode: bank.bank_code,
        productType,
        interestRate: Math.round((baseRate + seniorExtra) * 1000) / 1000,
        tenure,
        tenureUnit,
        tenureLabel,
        minDeposit: null,
        maxDeposit: null,
        customerCategory: "senior-citizen",
        seniorCitizenExtra: seniorExtra,
        effectiveDate,
        expiryDate: null,
        status: "active",
        source,
      });
    }
  }

  return records;
}

function flattenBankRatesPayload(payload) {
  const effectiveDate = new Date().toISOString().slice(0, 10);
  const records = [];

  for (const bank of payload.banks || []) {
    const source = bank.live ? "bank_api" : "fallback";
    records.push(
      ...flattenProductRates(bank, "FD", bank.fd, source, effectiveDate),
      ...flattenProductRates(bank, "RD", bank.rd, source, effectiveDate)
    );
  }

  return records;
}

async function fetchRatesFromBankProvider() {
  const payload = await fetchAllBankRates();
  return {
    records: flattenBankRatesPayload(payload),
    meta: payload.meta,
  };
}

module.exports = {
  parseTenureKey,
  formatTenureDisplay,
  flattenBankRatesPayload,
  fetchRatesFromBankProvider,
};
