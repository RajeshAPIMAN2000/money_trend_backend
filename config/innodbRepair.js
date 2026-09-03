const fs = require("fs");
const path = require("path");

function isInnoDbTableError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    error?.errno === 1813 ||
    error?.errno === 1932 ||
    msg.includes("doesn't exist in engine") ||
    msg.includes("tablespace") ||
    msg.includes("discard the tablespace")
  );
}

async function getDatadir(pool) {
  const [rows] = await pool.query(`SHOW VARIABLES LIKE 'datadir'`);
  return rows[0]?.Value || rows[0]?.value || null;
}

async function tableExists(pool, tableName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function tableIsHealthy(pool, tableName) {
  try {
    await pool.query(`SELECT 1 FROM \`${tableName}\` LIMIT 1`);
    return true;
  } catch (error) {
    if (error.errno === 1146 || isInnoDbTableError(error)) return false;
    throw error;
  }
}

async function removeOrphanTableFiles(pool, tableName) {
  const datadir = await getDatadir(pool);
  const [dbRows] = await pool.query(`SELECT DATABASE() AS db`);
  const dbName = dbRows[0]?.db;
  if (!datadir || !dbName) return false;

  const dir = path.join(datadir, dbName);
  let removed = false;
  for (const ext of [".ibd", ".frm"]) {
    const file = path.join(dir, `${tableName}${ext}`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      removed = true;
    }
  }
  return removed;
}

/**
 * CREATE TABLE with auto-repair for broken/orphan InnoDB tablespaces.
 */
async function ensureInnoDbTable(pool, tableName, createSql) {
  if (await tableIsHealthy(pool, tableName)) return;

  if (await tableExists(pool, tableName)) {
    try {
      await pool.query(`ALTER TABLE \`${tableName}\` DISCARD TABLESPACE`);
    } catch (_e) {
      // ignore
    }
    try {
      await pool.query(`DROP TABLE \`${tableName}\``);
    } catch (_e) {
      // ignore
    }
  }

  try {
    await pool.query(createSql);
    return;
  } catch (error) {
    if (!isInnoDbTableError(error)) throw error;
  }

  try {
    await pool.query(
      `CREATE TABLE \`${tableName}\` (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`
    );
    await pool.query(`ALTER TABLE \`${tableName}\` DISCARD TABLESPACE`);
    await pool.query(`DROP TABLE \`${tableName}\``);
  } catch (_shellError) {
    await removeOrphanTableFiles(pool, tableName);
    try {
      await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    } catch (_e) {
      // ignore
    }
  }

  await pool.query(createSql);
}

module.exports = {
  ensureInnoDbTable,
  isInnoDbTableError,
};
