/**
 * Fix MySQL orphan / broken InnoDB tablespaces (errno 1813, 1932).
 * Usage: node scripts/repairOrphanTables.js
 */
const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

const TABLES = ["fd_rd_rates", "fd_rd_rate_history"];

function isOrphanError(error) {
  const msg = String(error.message || "").toLowerCase();
  return (
    error.errno === 1813 ||
    error.errno === 1932 ||
    error.errno === 1146 ||
    msg.includes("doesn't exist") ||
    msg.includes("doesn't exist in engine") ||
    msg.includes("tablespace") ||
    msg.includes("discard the tablespace")
  );
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function tableIsHealthy(tableName) {
  try {
    await pool.query(`SELECT 1 FROM \`${tableName}\` LIMIT 1`);
    return true;
  } catch (error) {
    if (isOrphanError(error)) return false;
    throw error;
  }
}

async function getDatadir() {
  const [rows] = await pool.query(`SHOW VARIABLES LIKE 'datadir'`);
  return rows[0]?.Value || rows[0]?.value || null;
}

async function getDbName() {
  const [rows] = await pool.query(`SELECT DATABASE() AS db`);
  return rows[0]?.db;
}

function removeOrphanFiles(datadir, dbName, tableName) {
  const dir = path.join(datadir, dbName);
  const candidates = [
    path.join(dir, `${tableName}.ibd`),
    path.join(dir, `${tableName}.frm`),
  ];
  let removed = false;
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`   Removed orphan file: ${file}`);
      removed = true;
    }
  }
  return removed;
}

async function repairTable(tableName) {
  console.log(`\n==> Repairing ${tableName}`);

  if (await tableIsHealthy(tableName)) {
    console.log(`   ${tableName} is OK`);
    return;
  }

  if (await tableExists(tableName)) {
    try {
      await pool.query(`ALTER TABLE \`${tableName}\` DISCARD TABLESPACE`);
      console.log(`   DISCARD TABLESPACE ok`);
    } catch (error) {
      console.log(`   DISCARD skipped: ${error.message}`);
    }
    try {
      await pool.query(`DROP TABLE \`${tableName}\``);
      console.log(`   DROP TABLE ok`);
    } catch (error) {
      console.log(`   DROP failed: ${error.message}`);
    }
  } else {
    try {
      await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    } catch (_e) {
      // ignore
    }
  }

  // Ghost .ibd on disk (errno 1813 on CREATE)
  try {
    await pool.query(
      `CREATE TABLE \`${tableName}\` (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`
    );
    await pool.query(`ALTER TABLE \`${tableName}\` DISCARD TABLESPACE`);
    await pool.query(`DROP TABLE \`${tableName}\``);
    console.log(`   Shell table removed orphan tablespace`);
  } catch (error) {
    if (error.errno === 1813 || String(error.message).includes("Tablespace")) {
      const datadir = await getDatadir();
      const dbName = await getDbName();
      if (datadir && dbName) {
        const removed = removeOrphanFiles(datadir, dbName, tableName);
        if (removed) {
          try {
            await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
          } catch (_e) {
            // ignore
          }
        } else {
          console.log(`   No orphan .ibd found under ${path.join(datadir, dbName)}`);
        }
      }
    } else if (!(await tableExists(tableName))) {
      console.log(`   Shell repair note: ${error.message}`);
    }
  }

  if (await tableIsHealthy(tableName)) {
    console.log(`   ${tableName} repaired`);
  } else {
    console.log(`   ${tableName} cleared — will be recreated on server start`);
  }
}

async function main() {
  for (const table of TABLES) {
    await repairTable(table);
  }
  await pool.end();
  console.log("\nDone. Restart the server: npm run dev");
}

main().catch(async (error) => {
  console.error("Repair failed:", error.message);
  try {
    await pool.end();
  } catch (_e) {
    // ignore
  }
  process.exit(1);
});
