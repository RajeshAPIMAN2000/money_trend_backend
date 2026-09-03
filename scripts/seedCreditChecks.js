/**
 * Seed sample credit check records for local demo.
 * Usage: node scripts/seedCreditChecks.js [userId]
 */
require("dotenv").config();

const pool = require("../config/db");
const { ensureCoreTables } = require("../config/db_init");
const { runCreditCheck } = require("../services/creditCheckService");

async function ensureDemoUser() {
  const [users] = await pool.query(
    `SELECT u.id FROM users u
     JOIN kyc_documents k ON k.user_id = u.id
     WHERE u.kyc_status = 'verified' AND k.status = 'verified'
     LIMIT 1`
  );
  if (users.length) return users[0].id;

  const bcrypt = require("bcryptjs");
  const passwordHash = await bcrypt.hash("Demo@123", 10);
  const [insert] = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, kyc_status)
     VALUES ('Credit Demo User', 'credit.demo@moneytrend.in', :hash, '9876543210', 'verified')`,
    { hash: passwordHash }
  );
  const userId = insert.insertId;
  await pool.query(
    `INSERT INTO kyc_documents
      (user_id, method, pan_number, pan_full_name, aadhaar_number, status)
     VALUES
      (:userId, 'manual', 'ABCDE1234F', 'Credit Demo User', '123456789012', 'verified')`,
    { userId }
  );
  console.log(`[SEED] Created demo user id=${userId}`);
  return userId;
}

async function main() {
  process.env.CREDIT_CHECK_MODE = process.env.CREDIT_CHECK_MODE || "sandbox";
  await ensureCoreTables();

  const argUserId = Number(process.argv[2]);
  const userId = argUserId || (await ensureDemoUser());

  console.log(`[SEED] Running CIBIL credit check for user ${userId}...`);
  const result = await runCreditCheck({
    userId,
    bureau: "CIBIL",
    requestedBy: "SYSTEM",
    consentGiven: true,
    consentTimestamp: new Date(),
    consentIp: "127.0.0.1",
    consentVersion: "v1.0-demo",
  });

  console.log("[SEED] Credit check seeded:", {
    id: result.id,
    bureau: result.bureau,
    score: result.score,
    status: result.status,
  });

  await pool.end();
}

main().catch((err) => {
  console.error("[SEED] Failed:", err.message);
  process.exit(1);
});
