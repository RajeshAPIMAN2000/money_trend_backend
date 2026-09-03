/**
 * FD / RD market data (public, no user token required).
 *
 * Live rates are fetched from bank external APIs:
 *   SBI | HDFC | ICICI | Axis | Other banks
 * via services/banks/*. Historical graphs use RBI repo rate timeline.
 */
const { fetchAllBankRates } = require("../services/banks");
const {
  listMarketBanks,
  getMarketBankById,
  getBankRates: fetchBankRatesById,
  getBankRateHistory,
  getBankRateHistoryAllPeriods,
  getAllBanksRateTrend,
  enrichBanksWithIds,
  PERIOD_LABELS,
} = require("../services/marketBankService");

/** RBI repo rate timeline (official monetary policy announcements). */
const RBI_REPO_RATE_HISTORY = [
  { date: "2015-06-02", rate: 7.25 },
  { date: "2015-09-29", rate: 6.75 },
  { date: "2016-04-05", rate: 6.5 },
  { date: "2016-10-04", rate: 6.25 },
  { date: "2017-08-02", rate: 6.0 },
  { date: "2018-06-06", rate: 6.25 },
  { date: "2018-08-01", rate: 6.5 },
  { date: "2019-02-07", rate: 6.25 },
  { date: "2019-04-04", rate: 6.0 },
  { date: "2019-06-06", rate: 5.75 },
  { date: "2019-08-07", rate: 5.4 },
  { date: "2019-10-04", rate: 5.15 },
  { date: "2020-03-27", rate: 4.4 },
  { date: "2020-05-22", rate: 4.0 },
  { date: "2022-05-04", rate: 4.4 },
  { date: "2022-06-08", rate: 4.9 },
  { date: "2022-08-05", rate: 5.4 },
  { date: "2022-09-30", rate: 5.9 },
  { date: "2022-12-07", rate: 6.25 },
  { date: "2023-02-08", rate: 6.5 },
  { date: "2025-02-07", rate: 6.25 },
  { date: "2025-04-09", rate: 6.0 },
  { date: "2025-06-06", rate: 5.5 },
];

const DISCLAIMER =
  "FD/RD are bank deposit products regulated by RBI (Master Direction - Interest Rate on Deposits). " +
  "Live rates are fetched from configured bank APIs when available; otherwise RBI-aligned indicative rates are used. " +
  "Deposits are insured by DICGC up to Rs. 5 lakh per depositor per bank. " +
  "Verify final rates with the bank before investing. SEBI regulates market-linked securities, not bank FD/RD.";

function repoRateOn(date) {
  let current = RBI_REPO_RATE_HISTORY[0].rate;
  for (const point of RBI_REPO_RATE_HISTORY) {
    if (new Date(point.date) <= date) current = point.rate;
    else break;
  }
  return current;
}

function fdRateFromRepo(repo) {
  return Math.round((repo + 1.2) * 100) / 100;
}

function rdRateFromRepo(repo) {
  return Math.round((repo + 1.1) * 100) / 100;
}

function buildMonthlySeries(months) {
  const series = [];
  const now = new Date();
  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const repo = repoRateOn(d);
    series.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      repo_rate: repo,
      avg_fd_rate: fdRateFromRepo(repo),
      avg_rd_rate: rdRateFromRepo(repo),
    });
  }
  return series;
}

const PERIODS = {
  previous_month: 1,
  "1_year": 12,
  "3_years": 36,
  "5_years": 60,
  "10_years": 120,
};

function currentSnapshot(fdRates = []) {
  const now = new Date();
  const repo = repoRateOn(now);
  const oneYearRates = fdRates
    .map((b) => Number(b?.rates?.["1_year"]))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const avgFd =
    oneYearRates.length > 0
      ? Math.round((oneYearRates.reduce((a, b) => a + b, 0) / oneYearRates.length) * 100) / 100
      : fdRateFromRepo(repo);

  return {
    as_of: now.toISOString().slice(0, 10),
    rbi_repo_rate: repo,
    avg_fd_rate_1yr: avgFd,
    avg_rd_rate_1yr: rdRateFromRepo(repo),
  };
}

/** GET /market/rates — live bank APIs + fallback */
async function getCurrentRates(_req, res) {
  console.log("[MARKET] current rates via bank APIs");
  try {
    const { fd_rates, rd_rates, meta } = await fetchAllBankRates();
    const fdWithIds = await enrichBanksWithIds(fd_rates);
    const rdWithIds = await enrichBanksWithIds(rd_rates);

    return res.json({
      success: true,
      message: "Current FD and RD interest rates (bank APIs: SBI, HDFC, ICICI, Axis, Others)",
      data: {
        snapshot: currentSnapshot(fdWithIds),
        fd_rates: fdWithIds,
        rd_rates: rdWithIds,
        bank_api_status: meta,
        providers: {
          sbi: Boolean(process.env.SBI_FD_API_URL || process.env.SBI_API_URL),
          hdfc: Boolean(process.env.HDFC_FD_API_URL || process.env.HDFC_API_URL),
          icici: Boolean(process.env.ICICI_FD_API_URL || process.env.ICICI_API_URL),
          axis: Boolean(process.env.AXIS_FD_API_URL || process.env.AXIS_API_URL),
          other: Boolean(
            process.env.OTHER_BANK_API_URL ||
              process.env.PNB_FD_API_URL ||
              process.env.BOB_FD_API_URL ||
              process.env.KOTAK_FD_API_URL
          ),
        },
        regulatory: {
          regulator: "RBI",
          deposit_insurance: "DICGC up to Rs. 5,00,000 per depositor per bank",
          tds_rule:
            "TDS at 10% if annual FD interest exceeds Rs. 40,000 (Rs. 50,000 for senior citizens)",
          premature_withdrawal: "Allowed with penalty as per bank policy (RBI Master Direction)",
        },
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error("[MARKET] current rates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch current rates",
      error: error.message,
    });
  }
}

/** GET /market/history?period=... */
async function getRateHistory(req, res) {
  console.log("[MARKET] history requested, period:", req.query.period);
  try {
    const period = String(req.query.period || "").trim().toLowerCase();

    if (period && !PERIODS[period]) {
      return res.status(400).json({
        success: false,
        message: `Invalid period. Use one of: ${Object.keys(PERIODS).join(", ")}`,
      });
    }

    const buildFor = (key) => ({
      period: key,
      points: buildMonthlySeries(PERIODS[key]),
    });

    const data = period
      ? { snapshot: currentSnapshot(), graph: buildFor(period) }
      : {
          snapshot: currentSnapshot(),
          graphs: {
            previous_month: buildFor("previous_month"),
            "1_year": buildFor("1_year"),
            "3_years": buildFor("3_years"),
            "5_years": buildFor("5_years"),
            "10_years": buildFor("10_years"),
          },
        };

    return res.json({
      success: true,
      message: "FD/RD rate history for graphs (based on RBI repo rate timeline)",
      data: {
        ...data,
        source: "RBI monetary policy repo rate history + indicative bank spreads",
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error("[MARKET] history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rate history",
      error: error.message,
    });
  }
}

/** GET /market/repo-history */
async function getRepoHistory(_req, res) {
  console.log("[MARKET] repo history requested");
  try {
    return res.json({
      success: true,
      message: "RBI repo rate change history (official monetary policy announcements)",
      data: {
        current: currentSnapshot(),
        history: RBI_REPO_RATE_HISTORY,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error("[MARKET] repo history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch repo history",
      error: error.message,
    });
  }
}

/** GET /market/banks — list banks with market IDs */
async function listBanks(_req, res) {
  try {
    const banks = await listMarketBanks();
    return res.json({
      success: true,
      message: "Market banks for FD/RD",
      data: banks,
    });
  } catch (error) {
    console.error("[MARKET] list banks error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to list banks" });
  }
}

/** GET /market/banks/:id — single bank detail */
async function getBankById(req, res) {
  try {
    const bank = await getMarketBankById(Number(req.params.id));
    if (!bank) {
      return res.status(404).json({ success: false, message: "Bank not found" });
    }
    return res.json({ success: true, data: bank });
  } catch (error) {
    console.error("[MARKET] get bank error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch bank" });
  }
}

/** GET /market/banks/:id/rates — FD & RD rates for a specific bank */
async function getBankRates(req, res) {
  try {
    const category = req.query.category || null;
    const data = await fetchBankRatesById(Number(req.params.id), { category });
    return res.json({
      success: true,
      message: `FD and RD rates for ${data.bank.bankName}`,
      data,
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("[MARKET] bank rates error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch bank rates" });
  }
}

/** GET /market/banks/history/trend — 12-month rate trend graph for ALL banks */
async function getAllBanksHistoryTrend(req, res) {
  try {
    const options = {
      period: req.query.period || "1_year",
      tenure: req.query.tenure || req.query.tenure_label || "1_year",
      category: req.query.category || "regular",
      productType: req.query.productType || req.query.type || null,
      principal: req.query.principal || req.query.fd_principal || 100000,
      monthlyAmount: req.query.monthly_amount || req.query.monthlyAmount || 5000,
    };

    const data = await getAllBanksRateTrend(options);

    return res.json({
      success: true,
      message: `${data.period_label} for all banks (graph-ready)`,
      data: {
        ...data,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[MARKET] all banks trend error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch bank rate trends" });
  }
}

/** GET /market/banks/:id/history — graph-ready FD/RD rate + investment history */
async function getBankHistory(req, res) {
  try {
    const period = String(req.query.period || "").trim().toLowerCase();
    const options = {
      period: period || "1_year",
      tenure: req.query.tenure || req.query.tenure_label || "1_year",
      category: req.query.category || "regular",
      productType: req.query.productType || req.query.type || null,
      principal: req.query.principal || req.query.fd_principal || 100000,
      monthlyAmount: req.query.monthly_amount || req.query.monthlyAmount || 5000,
    };

    const data = period
      ? await getBankRateHistory(Number(req.params.id), options)
      : await getBankRateHistoryAllPeriods(Number(req.params.id), options);

    const periodLabel =
      data.period_label || (data.period ? PERIOD_LABELS[data.period] : null);

    return res.json({
      success: true,
      message: period
        ? `${periodLabel || "Rate trend"} for ${data.bank.bankName}`
        : `Investment graph data for ${data.bank.bankName} (all periods)`,
      data: {
        ...data,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[MARKET] bank history error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch bank history" });
  }
}

module.exports = {
  getCurrentRates,
  getRateHistory,
  getRepoHistory,
  listBanks,
  getBankById,
  getBankRates,
  getBankHistory,
  getAllBanksHistoryTrend,
};
