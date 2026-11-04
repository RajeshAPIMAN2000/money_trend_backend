/**
 * Drop and recreate the money_trend database (fixes widespread InnoDB 1932/1813 errors).
 * WARNING: Deletes all local data in this database.
 * Usage: node scripts/rebuildDatabase.js
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { loadEnv } = require("../config/loadEnv");
const { ensureCoreTables } = require("../config/db_init");

loadEnv();

async function getDatadir(connection) {
  const [rows] = await connection.query(`SHOW VARIABLES LIKE 'datadir'`);
  return rows[0]?.Value || rows[0]?.value;
}

async function dropAllTables(connection, dbName) {
  await connection.query(`USE \`${dbName}\``);
  await connection.query(`SET FOREIGN_KEY_CHECKS = 0`);
  const [tables] = await connection.query("SHOW TABLES");
  for (const row of tables) {
    const name = Object.values(row)[0];
    try {
      await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
      console.log(`   Dropped table: ${name}`);
    } catch (error) {
      console.log(`   Drop ${name} failed: ${error.message}`);
    }
  }
  await connection.query(`SET FOREIGN_KEY_CHECKS = 1`);
}

function clearDatabaseDirectory(dbDir) {
  if (!fs.existsSync(dbDir)) return;
  for (const file of fs.readdirSync(dbDir)) {
    const full = path.join(dbDir, file);
    try {
      fs.unlinkSync(full);
      console.log(`   Removed file: ${file}`);
    } catch (error) {
      console.log(`   Could not remove ${file}: ${error.message}`);
    }
  }
}

async function main() {
  const dbName = process.env.DB_NAME || "money_trend";
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  const datadir = await getDatadir(connection);
  const dbDir = path.join(datadir, dbName);

  console.log(`==> Dropping all tables in ${dbName}`);
  try {
    await dropAllTables(connection, dbName);
  } catch (error) {
    if (!String(error.message).includes("Unknown database")) {
      console.log(`   Note: ${error.message}`);
    }
  }

  console.log(`==> Clearing orphan files in ${dbDir}`);
  clearDatabaseDirectory(dbDir);

  console.log(`==> Dropping database: ${dbName}`);
  await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);

  console.log(`==> Creating database: ${dbName}`);
  await connection.query(
    `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();

  console.log("==> Running db_init (create all tables)...");
  await ensureCoreTables();
  console.log("\nDatabase rebuilt successfully. Start the app: npm run dev");
}

main().catch((error) => {
  console.error("Rebuild failed:", error.message);
  process.exit(1);
});
