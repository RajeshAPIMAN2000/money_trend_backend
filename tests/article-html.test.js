const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeArticleHtml } = require("../utils/articleHtml");
const { validateArticleInput, mapArticle } = require("../services/articleService");

const TAKEAWAYS =
  "<h2>Key Takeaways</h2><ul><li><strong>Start saving early:</strong> Save consistently.</li></ul>";

test("create payload keeps h1 and paragraph HTML", () => {
  const html = "<h1>Title</h1><p>Paragraph</p>";
  const { errors, data } = validateArticleInput({
    heading: "Building Wealth",
    content: html,
  });
  assert.equal(errors.length, 0);
  assert.match(data.description, /<h1>Title<\/h1>/);
  assert.match(data.description, /<p>Paragraph<\/p>/);
  assert.doesNotMatch(data.description, /&lt;/);
});

test("create payload keeps headings, lists, and strong tags", () => {
  const { errors, data } = validateArticleInput({
    title: "Building Wealth",
    description: TAKEAWAYS,
  });
  assert.equal(errors.length, 0);
  assert.match(data.description, /<h2>Key Takeaways<\/h2>/);
  assert.match(data.description, /<ul>/);
  assert.match(data.description, /<li>/);
  assert.match(data.description, /<strong>Start saving early:<\/strong>/);
  assert.doesNotMatch(data.description, /^h2/);
});

test("update payload keeps rich HTML", () => {
  const { errors, data } = validateArticleInput(
    {
      heading: "Building Wealth",
      content: "<h2>Updated</h2><p>Financial growth is a journey.</p>",
    },
    { isUpdate: true }
  );
  assert.equal(errors.length, 0);
  assert.match(data.description, /<h2>Updated<\/h2>/);
  assert.match(data.description, /<p>Financial growth is a journey\.<\/p>/);
});

test("GET mapping returns HTML in description and content", () => {
  const item = mapArticle({
    id: 1,
    type: "blog",
    heading: "Building Wealth",
    description: TAKEAWAYS,
    category: "Tax",
    image: null,
    created_by: 2,
    created_at: "2026-09-26",
    updated_at: "2026-09-26",
  });
  assert.equal(item.content, TAKEAWAYS);
  assert.equal(item.description, TAKEAWAYS);
  assert.doesNotMatch(item.content, /&lt;h2&gt;/);
});

test("script tags and event handlers are removed", () => {
  const clean = sanitizeArticleHtml(
    '<p>Safe</p><script>alert(1)</script><img src="https://cdn.example.com/a.jpg" alt="Blog image" onerror="alert(1)">'
  );
  assert.match(clean, /<p>Safe<\/p>/);
  assert.match(clean, /<img/);
  assert.match(clean, /alt="Blog image"/);
  assert.match(clean, /src="https:\/\/cdn\.example\.com\/a\.jpg"/);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /alert\(1\)/);
});

test("javascript links are stripped", () => {
  const clean = sanitizeArticleHtml('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(clean, /javascript:/i);
});

test("escaped HTML entities are stored as tags", () => {
  const clean = sanitizeArticleHtml("&lt;h2&gt;Key Takeaways&lt;/h2&gt;");
  assert.match(clean, /<h2>Key Takeaways<\/h2>/);
  assert.doesNotMatch(clean, /&lt;h2&gt;/);
});

test("non-string content is rejected", () => {
  const { errors } = validateArticleInput({
    heading: "Building Wealth",
    content: { html: "<p>nope</p>" },
  });
  assert.ok(errors.some((message) => /HTML string/i.test(message)));
});
