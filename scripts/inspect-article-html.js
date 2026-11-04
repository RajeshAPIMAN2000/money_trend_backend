/**
 * Read-only classifier for articles.description.
 * Does not update rows.
 *
 * Usage: node scripts/inspect-article-html.js
 */
const pool = require("../config/db");

function classify(description) {
  const text = String(description || "");
  const hasRawTag = /<\/?[a-z][^>]*>/i.test(text);
  const hasEscapedTag = /&lt;\/?[a-z]/i.test(text) || /&#0*60;/i.test(text);
  if (hasRawTag && !hasEscapedTag) return "valid_html";
  if (!hasRawTag && hasEscapedTag) return "escaped_html";
  if (hasRawTag && hasEscapedTag) return "mixed";
  return "plain_or_malformed";
}

async function main() {
  const [rows] = await pool.query(`SELECT id, type, heading, description FROM articles ORDER BY id ASC`);
  const summary = { valid_html: 0, escaped_html: 0, mixed: 0, plain_or_malformed: 0 };
  for (const row of rows) {
    const kind = classify(row.description);
    summary[kind] += 1;
    console.log(`#${row.id} ${row.type} [${kind}] ${row.heading}`);
  }
  console.log("summary", summary, "total", rows.length);
  console.log(
    "No rows were changed. Escaped HTML can be reviewed separately. Tag-stripped records cannot be restored."
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
