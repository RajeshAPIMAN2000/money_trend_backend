/**
 * Shared HTTP helper for bank FD/RD rate APIs.
 * Each bank adapter calls this with its configured URL + API key.
 */
async function fetchBankJson(url, { apiKey, timeoutMs = 8000, headers = {} } = {}) {
  if (!url || !String(url).trim()) {
    const err = new Error("Bank API URL not configured");
    err.code = "BANK_API_NOT_CONFIGURED";
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
        ...headers,
      },
    });

    if (!res.ok) {
      const err = new Error(`Bank API HTTP ${res.status}`);
      err.code = "BANK_API_HTTP_ERROR";
      err.status = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize various bank API payload shapes into Money Trend format.
 * Accepts either:
 *  { fd: {...}, rd: {...}, senior_citizen_extra }
 *  { fdRates / fd_rates, rdRates / rd_rates }
 *  { data: { fd, rd } }
 */
function normalizeBankPayload(raw, fallback) {
  const root = raw?.data && typeof raw.data === "object" ? raw.data : raw || {};
  const fd = root.fd || root.fdRates || root.fd_rates || root.fixedDeposit || fallback.fd;
  const rd = root.rd || root.rdRates || root.rd_rates || root.recurringDeposit || fallback.rd;
  const senior =
    root.senior_citizen_extra ??
    root.seniorCitizenExtra ??
    root.senior_extra ??
    fallback.senior_citizen_extra;

  return {
    bank_code: fallback.bank_code,
    bank: root.bank || root.bankName || root.bank_name || fallback.bank,
    type: root.type || root.bankType || fallback.type,
    fd,
    rd,
    senior_citizen_extra: Number(senior) || 0,
  };
}

module.exports = { fetchBankJson, normalizeBankPayload };
