const { normalize } = require("./normalizer");
const { mockCibil, mockNoHit } = require("./mockResponses");
const { isEquifaxLiveMode } = require("./equifaxConfig");

const name = "CIBIL";

/**
 * How CIBIL bureau pulls are backed:
 * - mock (default in CREDIT_CHECK_MODE=sandbox)
 * - equifax  → Equifax Consumer Data Suite (scopes from Equifax Developer Dashboard)
 * - native   → legacy CIBIL_* HTTP pull (if you later get TransUnion CIBIL credentials)
 *
 * Set CIBIL_PROVIDER=equifax once Equifax CDS credentials are ready for test/live.
 */
function resolveCibilBackend() {
  const explicit = String(process.env.CIBIL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "equifax" || explicit === "equifax_cds" || explicit === "cds") return "equifax";
  if (explicit === "native" || explicit === "cibil" || explicit === "transunion") return "native";

  // Auto: if Equifax CDS client credentials exist and we are not in sandbox-only mock mode, use Equifax.
  const hasEquifax =
    Boolean(String(process.env.EQUIFAX_CLIENT_ID || "").trim()) &&
    Boolean(String(process.env.EQUIFAX_CLIENT_SECRET || "").trim());
  if (hasEquifax && isEquifaxLiveMode()) return "equifax";
  return "mock";
}

async function fetchViaEquifaxCds(input) {
  const equifaxProvider = require("./equifaxProvider");
  const report = await equifaxProvider.fetchCreditReport(input);
  // Keep bureau label CIBIL for existing MoneyTrend score-card APIs,
  // while retaining Equifax CDS provenance in rawResponse.
  return {
    ...report,
    bureau: "CIBIL",
    scoreRange: report.scoreRange || { min: 300, max: 900 },
    rawResponse: {
      ...(report.rawResponse || {}),
      _providerBackend: "EQUIFAX_CDS",
      _displayBureau: "CIBIL",
      _note:
        "Score pulled via Equifax Consumer Data Suite (enrollment + creditScore + creditReport scopes).",
    },
  };
}

async function fetchViaNativeCibil(input) {
  const { fetchWithRetry } = require("./httpClient");
  const baseUrl = process.env.CIBIL_API_BASE_URL;
  const apiKey = process.env.CIBIL_API_KEY;
  const clientId = process.env.CIBIL_CLIENT_ID;

  if (!baseUrl || !apiKey) {
    throw Object.assign(new Error("CIBIL native API credentials not configured"), {
      code: "CIBIL_CREDENTIALS_MISSING",
    });
  }

  const payload = {
    pan: input.pan,
    name: input.fullName,
    dob: input.dob,
    mobile: input.mobile,
    address: input.address,
    consentRef: input.consentRef,
  };

  const raw = await fetchWithRetry(`${String(baseUrl).replace(/\/+$/, "")}/v1/credit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Client-Id": clientId || "",
    },
    body: JSON.stringify(payload),
  });

  return normalize(name, raw);
}

async function fetchCreditReport(input) {
  const mode = String(process.env.CREDIT_CHECK_MODE || "sandbox").toLowerCase();
  const backend = resolveCibilBackend();

  if (mode === "sandbox" || backend === "mock") {
    const raw =
      input.simulateNoHit === true ? mockNoHit("CIBIL") : mockCibil(input);
    return normalize(name, raw);
  }

  if (backend === "equifax") {
    console.log("[CIBIL] using Equifax CDS backend for credit score pull");
    return fetchViaEquifaxCds(input);
  }

  return fetchViaNativeCibil(input);
}

module.exports = { name, fetchCreditReport, resolveCibilBackend };
