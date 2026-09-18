/**
 * Smoke-test admin login + blog create (no password printed).
 * Usage: node scripts/smoke-admin-blog.js
 */
const { loadEnv } = require("../config/loadEnv");
loadEnv();

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4000";

async function main() {
  const email = process.env.SUPER_ADMIN_1_EMAIL || "rudraraay@gmail.com";
  const password = process.env.SUPER_ADMIN_1_PASSWORD || "Moneytrend@2026#";

  const loginRes = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginRes.json();
  console.log("login_status", loginRes.status, "success", loginJson.success, "message", loginJson.message);
  if (!loginJson.success) {
    console.log("login_hint", loginJson.hint || loginJson.error || null);
    process.exit(1);
  }

  const token = loginJson.data?.accessToken || loginJson.data?.token;
  console.log("token_present", Boolean(token), "admin_id", loginJson.data?.admin?.id);

  const blogRes = await fetch(`${BASE}/api/admin/blogs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      heading: `Smoke blog ${Date.now()}`,
      description: "Automated smoke test blog body",
      status: "draft",
    }),
  });
  const blogJson = await blogRes.json();
  console.log("blog_status", blogRes.status, "success", blogJson.success, "message", blogJson.message);
  if (!blogJson.success) {
    console.log("blog_error", blogJson.error || blogJson.code || null);
    process.exit(1);
  }
  console.log("blog_id", blogJson.data?.id);
  process.exit(0);
}

main().catch((e) => {
  console.error("smoke_failed", e.message);
  process.exit(1);
});
