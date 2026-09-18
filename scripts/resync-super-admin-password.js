/**
 * Re-hash Super Admin #1 password from env (fixes .env `#` truncation).
 * Usage: node scripts/resync-super-admin-password.js
 */
const { loadEnv } = require("../config/loadEnv");
loadEnv();

const bcrypt = require("bcryptjs");
const pool = require("../config/db");

async function main() {
  const email = String(process.env.SUPER_ADMIN_1_EMAIL || "rudraraay@gmail.com").toLowerCase();
  const password = process.env.SUPER_ADMIN_1_PASSWORD || "Moneytrend@2026#";
  const passwordHash = await bcrypt.hash(password, 10);

  const [result] = await pool.query(
    `UPDATE users
     SET password_hash = :passwordHash,
         role = 'admin',
         staff_active = 1
     WHERE email = :email`,
    { passwordHash, email },
  );

  console.log("updated_rows", result.affectedRows, "email", email);
  console.log("password_includes_hash_char", password.endsWith("#"));

  const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4000";
  const loginRes = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginRes.json();
  console.log("login_status", loginRes.status, "success", loginJson.success, "message", loginJson.message);
  if (!loginJson.success) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
