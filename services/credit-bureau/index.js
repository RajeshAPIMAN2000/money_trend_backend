const cibilProvider = require("./cibilProvider");
const experianProvider = require("./experianProvider");
const equifaxProvider = require("./equifaxProvider");
const crifProvider = require("./crifProvider");

const BUREAUS = ["CIBIL", "EXPERIAN", "EQUIFAX", "CRIF"];

const providers = {
  CIBIL: cibilProvider,
  EXPERIAN: experianProvider,
  EQUIFAX: equifaxProvider,
  CRIF: crifProvider,
};

function getProvider(bureauName) {
  const key = String(bureauName || "").toUpperCase();
  const provider = providers[key];
  if (!provider) {
    throw new Error(
      `Unknown credit bureau: ${bureauName}. Supported: ${BUREAUS.join(", ")}`
    );
  }
  return provider;
}

function listBureaus() {
  return [...BUREAUS];
}

module.exports = { getProvider, listBureaus, BUREAUS };
