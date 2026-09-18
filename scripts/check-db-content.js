const { loadEnv } = require("../config/loadEnv");
loadEnv();
const pool = require("../config/db");

(async () => {
  const db = process.env.DB_NAME || "money_trend";
  console.log("database:", db);

  const [admins] = await pool.query(
    `SELECT id, full_name, email, role, created_at FROM users WHERE role IN ('admin','sub_admin') ORDER BY id`
  );
  console.log("\n=== SUPER ADMINS ===");
  console.log("count:", admins.length);
  admins.forEach((a) =>
    console.log(`id=${a.id} | ${a.full_name} | ${a.email} | ${a.role} | created=${a.created_at}`)
  );

  const [legacy] = await pool.query(
    `SELECT id, email FROM users WHERE email='admin@moneytrend.in' LIMIT 1`
  );
  console.log("legacy admin@moneytrend.in present:", legacy.length > 0);

  const [blogs] = await pool.query(
    `SELECT id, heading, status, created_by, created_at FROM articles WHERE type='blog' ORDER BY id DESC LIMIT 10`
  );
  console.log("\n=== BLOGS (latest 10) ===");
  console.log("count_shown:", blogs.length);
  blogs.forEach((b) =>
    console.log(`id=${b.id} | ${b.heading} | status=${b.status} | by=${b.created_by} | ${b.created_at}`)
  );

  const [news] = await pool.query(
    `SELECT id, heading, status, created_by, created_at FROM articles WHERE type='news' ORDER BY id DESC LIMIT 10`
  );
  console.log("\n=== NEWS (latest 10) ===");
  console.log("count_shown:", news.length);
  news.forEach((n) =>
    console.log(`id=${n.id} | ${n.heading} | status=${n.status} | by=${n.created_by} | ${n.created_at}`)
  );

  const [counts] = await pool.query(
    `SELECT type, status, COUNT(*) AS total FROM articles GROUP BY type, status`
  );
  console.log("\n=== ARTICLE TOTALS ===");
  console.log(counts);

  process.exit(0);
})().catch((e) => {
  console.error("DB check failed:", e.message);
  process.exit(1);
});
