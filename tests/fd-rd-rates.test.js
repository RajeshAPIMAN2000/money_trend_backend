const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTenureKey,
  formatTenureDisplay,
  flattenBankRatesPayload,
} = require("../services/fdRdRateProvider");
const {
  buildTickerPayload,
  buildHighestRates,
  isRateCurrentlyValid,
} = require("../services/fdRdRateService");
const { FALLBACK_BANK_RATES } = require("../services/banks/fallbackRates");

describe("fdRdRateProvider", () => {
  it("parses year tenure keys", () => {
    const t = parseTenureKey("5_years");
    assert.equal(t.tenure, 5);
    assert.equal(t.tenureUnit, "years");
  });

  it("parses month tenure keys", () => {
    const t = parseTenureKey("6_months");
    assert.equal(t.tenure, 6);
    assert.equal(t.tenureUnit, "months");
  });

  it("parses day range tenure keys", () => {
    const t = parseTenureKey("7-45_days");
    assert.equal(t.tenure, 45);
    assert.equal(t.tenureUnit, "days");
  });

  it("formats tenure display", () => {
    assert.equal(formatTenureDisplay(5, "years"), "5 years");
    assert.equal(formatTenureDisplay(1, "years"), "1 year");
  });

  it("flattens bank payload into rate records", () => {
    const payload = {
      banks: [{ ...FALLBACK_BANK_RATES.hdfc, live: false, source: "fallback" }],
    };
    const records = flattenBankRatesPayload(payload);
    assert.ok(records.length > 0);
    assert.ok(records.some((r) => r.productType === "FD" && r.bankCode === "hdfc"));
    assert.ok(records.some((r) => r.customerCategory === "senior-citizen"));
  });
});

describe("fdRdRateService highest-rate logic", () => {
  const today = new Date("2026-09-01");
  const rows = [
    {
      id: 1,
      bank_name: "ABC Bank",
      bank_code: "abc",
      product_type: "FD",
      interest_rate: 8.75,
      tenure: 5,
      tenure_unit: "years",
      tenure_label: "5_years",
      customer_category: "regular",
      effective_date: "2026-01-01",
      expiry_date: null,
      status: "active",
    },
    {
      id: 2,
      bank_name: "PQR Bank",
      bank_code: "pqr",
      product_type: "FD",
      interest_rate: 8.7,
      tenure: 3,
      tenure_unit: "years",
      tenure_label: "3_years",
      customer_category: "regular",
      effective_date: "2026-01-01",
      expiry_date: null,
      status: "active",
    },
    {
      id: 3,
      bank_name: "XYZ Bank",
      bank_code: "xyz",
      product_type: "RD",
      interest_rate: 8.5,
      tenure: 5,
      tenure_unit: "years",
      tenure_label: "5_years",
      customer_category: "regular",
      effective_date: "2026-01-01",
      expiry_date: null,
      status: "active",
    },
    {
      id: 4,
      bank_name: "Old Bank",
      bank_code: "old",
      product_type: "FD",
      interest_rate: 9.0,
      tenure: 1,
      tenure_unit: "years",
      tenure_label: "1_year",
      customer_category: "regular",
      effective_date: "2025-01-01",
      expiry_date: "2025-12-31",
      status: "active",
    },
    {
      id: 5,
      bank_name: "Inactive Bank",
      bank_code: "inact",
      product_type: "FD",
      interest_rate: 9.5,
      tenure: 1,
      tenure_unit: "years",
      tenure_label: "1_year",
      customer_category: "regular",
      effective_date: "2026-01-01",
      expiry_date: null,
      status: "inactive",
    },
    {
      id: 6,
      bank_name: "Tie Bank",
      bank_code: "tie",
      product_type: "FD",
      interest_rate: 8.75,
      tenure: 2,
      tenure_unit: "years",
      tenure_label: "2_years",
      customer_category: "regular",
      effective_date: "2026-01-01",
      expiry_date: null,
      status: "active",
    },
  ];

  it("excludes inactive rates", () => {
    const result = buildHighestRates(rows, { productType: "FD", limit: 10 });
    assert.ok(!result.some((r) => r.bank_code === "inact"));
  });

  it("excludes expired rates", () => {
    const result = buildHighestRates(rows, { productType: "FD", limit: 10 });
    assert.ok(!result.some((r) => r.bank_code === "old"));
  });

  it("returns highest FD rates first", () => {
    const result = buildHighestRates(rows, { productType: "FD", limit: 10 });
    assert.equal(result[0].interest_rate, 8.75);
    assert.ok(Number(result[0].interest_rate) >= Number(result[1]?.interest_rate || 0));
  });

  it("includes tied highest rates", () => {
    const result = buildHighestRates(rows, { productType: "FD", limit: 10 });
    const topRate = Number(result[0].interest_rate);
    const tied = result.filter((r) => Number(r.interest_rate) === topRate);
    assert.equal(tied.length, 2);
  });

  it("separates FD and RD in ticker payload", () => {
    const payload = buildTickerPayload(rows, { limit: 5 });
    assert.ok(payload.fd.length > 0);
    assert.ok(payload.rd.length > 0);
    assert.equal(payload.rd[0].bankName, "XYZ Bank");
    assert.equal(payload.fd[0].interestRate, 8.75);
  });

  it("validates current rate window", () => {
    assert.equal(isRateCurrentlyValid(rows[0], today), true);
    assert.equal(isRateCurrentlyValid(rows[3], today), false);
    assert.equal(isRateCurrentlyValid(rows[4], today), false);
  });

  it("filters by type=FD only", () => {
    const payload = buildTickerPayload(rows, { limit: 5, type: "FD" });
    assert.ok(payload.fd);
    assert.equal(payload.rd, undefined);
  });
});

describe("marketBankService graph payload", () => {
  const { buildGraphPayload } = require("../services/marketBankService");

  it("builds chart-ready labels and series", () => {
    const monthlyRates = [
      { month: "2025-07", fd_rate: 6.5, rd_rate: 6.4 },
      { month: "2025-08", fd_rate: 6.7, rd_rate: 6.5 },
    ];
    const graph = buildGraphPayload(monthlyRates, { principal: 100000, monthlyAmount: 5000, tenureMonths: 12 });

    assert.equal(graph.labels.length, 2);
    assert.ok(graph.series.some((s) => s.key === "fd_rate"));
    assert.ok(graph.series.some((s) => s.key === "fd_maturity_value"));
    assert.equal(graph.points[0].fd_rate, 6.5);
    assert.ok(graph.points[1].fd_maturity_value > 100000);
    assert.ok(graph.yAxes.rate);
    assert.ok(graph.yAxes.amount);
  });

  it("filters graph series for FD only", () => {
    const monthlyRates = [{ month: "2025-08", fd_rate: 7, rd_rate: 6.5 }];
    const graph = buildGraphPayload(monthlyRates, { productType: "FD", tenureMonths: 12 });
    assert.equal(graph.series.length, 2);
    assert.ok(graph.series.every((s) => s.key.startsWith("fd_")));
  });
});
