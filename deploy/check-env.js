const { loadEnv } = require("../config/loadEnv");

loadEnv();

const required = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DB_NAME"];
const warnings = [];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.DB_PASSWORD) warnings.push("DB_PASSWORD is empty");
  if ((process.env.JWT_ACCESS_SECRET || "").includes("dev_")) {
    warnings.push("JWT_ACCESS_SECRET looks like a dev value");
  }
  if (process.env.CORS_ORIGIN === "*") warnings.push("CORS_ORIGIN=* in production is insecure");
}

if (warnings.length) {
  console.warn("Warnings:");
  warnings.forEach((w) => console.warn(`  - ${w}`));
}

console.log(`OK  NODE_ENV=${process.env.NODE_ENV || "development"}  PORT=${process.env.PORT || 4000}`);
