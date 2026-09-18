const pool = require("../config/db");
const { loadEnv } = require("../config/loadEnv");
loadEnv();

(async () => {
  const [cols] = await pool.query(
    "SHOW COLUMNS FROM users WHERE Field IN ('staff_permissions','staff_active','role')"
  );
  console.log(
    "columns:",
    cols.map((c) => `${c.Field}:${c.Type}`).join(" | ") || "(none)"
  );
  const [admins] = await pool.query(
    "SELECT id, email, role, staff_active FROM users WHERE role IN ('admin','sub_admin') ORDER BY id"
  );
  console.log("staff_count:", admins.length);
  for (const a of admins) {
    console.log(`- id=${a.id} email=${a.email} role=${a.role} active=${a.staff_active}`);
  }
  const legacy = await pool.query(
    "SELECT id, email FROM users WHERE email = 'admin@moneytrend.in' LIMIT 1"
  );
  console.log("legacy_admin_present:", legacy[0].length > 0);
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
