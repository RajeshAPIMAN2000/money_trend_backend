const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

/**
 * Load env files for local + Hostinger VPS.
 * Order (later overrides earlier):
 *   1. .env
 *   2. .env.local (dev machine only; never deploy)
 *   3. .env.production when NODE_ENV=production (or file exists on VPS)
 */
function loadEnv(rootDir = process.cwd()) {
  const root = rootDir || process.cwd();
  const candidates = [
    path.join(root, ".env"),
    path.join(root, ".env.local"),
  ];

  // Allow explicit production file on VPS without relying only on NODE_ENV before load
  const prodFile = path.join(root, ".env.production");
  if (fs.existsSync(prodFile)) {
    candidates.push(prodFile);
  }

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    dotenv.config({ path: file, override: true });
  }

  // If still unset, default development for local; VPS ecosystem sets production
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }

  return {
    nodeEnv: process.env.NODE_ENV,
    loaded: candidates.filter((f) => fs.existsSync(f)),
  };
}

module.exports = { loadEnv };
