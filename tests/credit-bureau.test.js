const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getProvider, listBureaus, BUREAUS } = require("../services/credit-bureau");
const { normalize } = require("../services/credit-bureau/normalizer");
const {
  mockCibil,
  mockExperian,
  mockEquifax,
  mockCrif,
  mockNoHit,
} = require("../services/credit-bureau/mockResponses");

describe("credit-bureau factory", () => {
  it("lists all supported bureaus", () => {
    assert.deepEqual(listBureaus(), BUREAUS);
    assert.equal(BUREAUS.length, 4);
  });

  it("returns provider for each bureau", () => {
    for (const bureau of BUREAUS) {
      const provider = getProvider(bureau);
      assert.equal(provider.name, bureau);
      assert.equal(typeof provider.fetchCreditReport, "function");
    }
  });

  it("throws for unknown bureau", () => {
    assert.throws(() => getProvider("INVALID"), /Unknown credit bureau/);
  });
});

describe("credit-bureau normalizer", () => {
  const input = { pan: "ABCDE1234F" };

  it("normalizes CIBIL mock response", () => {
    const report = normalize("CIBIL", mockCibil(input));
    assert.equal(report.bureau, "CIBIL");
    assert.equal(report.score, 742);
    assert.equal(report.status, "SUCCESS");
    assert.ok(Array.isArray(report.accounts));
    assert.ok(report.accounts.length >= 1);
    assert.ok(report.rawResponse);
  });

  it("normalizes Experian mock response", () => {
    const report = normalize("EXPERIAN", mockExperian(input));
    assert.equal(report.bureau, "EXPERIAN");
    assert.equal(report.score, 718);
    assert.equal(report.status, "SUCCESS");
  });

  it("normalizes Equifax mock response", () => {
    const report = normalize("EQUIFAX", mockEquifax(input));
    assert.equal(report.bureau, "EQUIFAX");
    assert.equal(report.score, 705);
  });

  it("normalizes CRIF mock response", () => {
    const report = normalize("CRIF", mockCrif(input));
    assert.equal(report.bureau, "CRIF");
    assert.equal(report.score, 690);
  });

  it("handles NO_HIT across bureaus", () => {
    for (const bureau of BUREAUS) {
      const report = normalize(bureau, mockNoHit(bureau));
      assert.equal(report.status, "NO_HIT");
      assert.equal(report.score, null);
      assert.equal(report.accounts.length, 0);
    }
  });
});
