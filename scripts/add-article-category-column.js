const { loadEnv } = require("../config/loadEnv");
loadEnv();
const pool = require("../config/db");

async function main() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'articles'
       AND COLUMN_NAME = 'category'`
  );
  if (!Number(rows[0].cnt)) {
    await pool.query(
      "ALTER TABLE articles ADD COLUMN category VARCHAR(100) NULL AFTER description"
    );
    console.log("added category column");
  } else {
    console.log("category column already exists");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
