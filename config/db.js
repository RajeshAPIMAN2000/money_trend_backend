const mysql = require("mysql2/promise");
const { loadEnv } = require("./loadEnv");

// Ensure .env is loaded even when this module is required before app.js finishes
loadEnv();

function getDbConfig() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const user = String(process.env.DB_USER || (isProd ? "" : "root")).trim();
  const password = process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : "";
  const host = String(process.env.DB_HOST || "127.0.0.1").trim();
  const port = Number(process.env.DB_PORT || 3306);
  const database = String(process.env.DB_NAME || "money_trend").trim();

  return { host, port, user, password, database, isProd };
}

function assertDbConfig() {
  const cfg = getDbConfig();
  if (!cfg.user) {
    const err = new Error(
      "DB_USER is missing. On Hostinger VPS set DB_USER=moneytrend (not root) in /var/www/moneytrend/backend/.env"
    );
    err.code = "DB_CONFIG";
    throw err;
  }
  if (cfg.isProd && cfg.user === "root" && !cfg.password) {
    const err = new Error(
      "Production MySQL cannot use root with empty password. Create a DB user and set DB_USER + DB_PASSWORD in .env"
    );
    err.code = "DB_CONFIG";
    throw err;
  }
  return cfg;
}

const initial = getDbConfig();

const pool = mysql.createPool({
  host: initial.host,
  port: initial.port,
  user: initial.user || "root",
  password: initial.password,
  database: initial.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

async function pingDatabase() {
  const cfg = assertDbConfig();
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1 AS ok");
    return {
      ok: true,
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      database: cfg.database,
    };
  } finally {
    conn.release();
  }
}

module.exports = pool;
module.exports.pingDatabase = pingDatabase;
module.exports.getDbConfig = getDbConfig;
module.exports.assertDbConfig = assertDbConfig;
