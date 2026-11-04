/**
 * Write a local HTML preview of the welcome email (opens in browser).
 * Usage: node scripts/preview-welcome-email.js
 */
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../config/loadEnv");
loadEnv();

const { buildWelcomeEmail } = require("../services/email/templates/welcomeEmail");
const { getLogoSources, getBackgroundSources } = require("../services/email/templates/layout");

const content = buildWelcomeEmail({
  firstName: "Rajesh",
  email: "demo@moneytrend.in",
  registeredAt: new Date(),
});

let html = content.html;
const logo = getLogoSources();
const bg = getBackgroundSources();

if (logo.filePath) {
  html = html.split("cid:moneytrend-logo").join(`file:///${logo.filePath.replace(/\\/g, "/")}`);
}
if (bg.filePath) {
  html = html.split("cid:moneytrend-bg").join(`file:///${bg.filePath.replace(/\\/g, "/")}`);
}

const out = path.join(process.cwd(), "uploads", "email-preview-welcome.html");
fs.writeFileSync(out, html, "utf8");
console.log("Wrote preview:", out);
console.log("Logo:", logo.filePath || "(missing)");
console.log("Background:", bg.filePath || "(missing)");
console.log("Open that HTML file in your browser to review the template.");
