const sanitizeHtml = require("sanitize-html");

/** Rich-text blog/news body size. Matches articles.description LONGTEXT usage. */
const ARTICLE_HTML_MAX = 500000;

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "span",
  "div",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "pre",
  "code",
  "figure",
  "figcaption",
  "sub",
  "sup",
];

/**
 * If the payload is entity-escaped HTML and has no raw tags, decode once
 * so "&lt;h2&gt;" is stored as "<h2>" rather than returned as entities.
 * Raw HTML is left untouched.
 */
function decodeEscapedHtmlIfNeeded(value) {
  const text = String(value ?? "");
  if (text.includes("<")) return text;
  if (!/&lt;|&#0*60;|&#x0*3c;/i.test(text)) return text;
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;|&#0*60;|&#x0*3c;/gi, "<")
    .replace(/&gt;|&#0*62;|&#x0*3e;/gi, ">");
}

/**
 * Keep safe rich-text HTML for the article body.
 * Heading, category, and other plain fields must not use this.
 */
function sanitizeArticleHtml(value, maxLen = ARTICLE_HTML_MAX) {
  if (value == null) return "";
  if (typeof value !== "string") {
    const err = new Error("content must be an HTML string");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const decoded = decodeEscapedHtmlIfNeeded(value);
  const clean = sanitizeHtml(decoded, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title", "class"],
      img: ["src", "alt", "title", "width", "height", "class"],
      td: ["colspan", "rowspan", "class"],
      th: ["colspan", "rowspan", "class"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
    transformTags: {
      a: (tagName, attribs) => {
        const next = { ...attribs };
        if (next.target === "_blank") {
          next.rel = "noopener noreferrer";
        }
        const href = String(next.href || "");
        if (/^\s*javascript:/i.test(href)) delete next.href;
        return { tagName, attribs: next };
      },
    },
  });

  return clean.trim().slice(0, maxLen);
}

module.exports = {
  ARTICLE_HTML_MAX,
  ALLOWED_TAGS,
  decodeEscapedHtmlIfNeeded,
  sanitizeArticleHtml,
};
