const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

async function getDatadir() {
  const [rows] = await pool.query(`SHOW VARIABLES LIKE 'datadir'`);
  return rows[0]?.Value || rows[0]?.value;
}

async function main() {
  const [tables] = await pool.query("SHOW TABLES");
  const broken = [];

  for (const row of tables) {
    const name = Object.values(row)[0];
    try {
      await pool.query(`SELECT 1 FROM \`${name}\` LIMIT 1`);
      console.log(`${name}: OK`);
    } catch (error) {
      console.log(`${name}: BROKEN (${error.errno}) ${error.message}`);
      broken.push(name);
    }
  }

  const datadir = await getDatadir();
  const [dbRows] = await pool.query("SELECT DATABASE() AS db");
  const dbName = dbRows[0]?.db;
  const dbDir = path.join(datadir, dbName);

  console.log(`\nOrphan .ibd files in ${dbDir}:`);
  if (fs.existsSync(dbDir)) {
    for (const file of fs.readdirSync(dbDir)) {
      if (!file.endsWith(".ibd")) continue;
      const table = file.replace(/\.ibd$/, "");
      const inSchema = tables.some((r) => Object.values(r)[0] === table);
      console.log(`  ${file} — in schema: ${inSchema}`);
    }
  }

  console.log(`\nBroken tables: ${broken.join(", ") || "none"}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
