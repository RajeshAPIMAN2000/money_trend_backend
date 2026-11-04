const pool = require("../config/db");

const DEFAULT_ROBOTS = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: {SITE_URL}/sitemap.xml
`;

async function getSeoSettings() {
  const [rows] = await pool.query(
    `SELECT id, site_name, canonical_base_url, google_analytics_code, robots_txt,
            sitemap_extra_urls, updated_at
     FROM seo_settings
     ORDER BY id ASC
     LIMIT 1`
  );
  if (!rows.length) {
    return {
      id: null,
      site_name: "Money Trend",
      canonical_base_url: process.env.FRONTEND_ORIGIN || process.env.CLIENT_ORIGIN || "",
      google_analytics_code: "",
      robots_txt: DEFAULT_ROBOTS.replace("{SITE_URL}", process.env.FRONTEND_ORIGIN || "https://moneytrend.in"),
      sitemap_extra_urls: [],
      updated_at: null,
    };
  }
  const row = rows[0];
  let extras = row.sitemap_extra_urls;
  if (typeof extras === "string") {
    try {
      extras = JSON.parse(extras);
    } catch (_e) {
      extras = [];
    }
  }
  return {
    ...row,
    google_analytics_code: row.google_analytics_code || "",
    robots_txt: row.robots_txt || DEFAULT_ROBOTS,
    sitemap_extra_urls: Array.isArray(extras) ? extras : [],
  };
}

async function upsertSeoSettings(payload) {
  const current = await getSeoSettings();
  const siteName = payload.site_name != null ? String(payload.site_name).trim() : current.site_name;
  const baseUrl =
    payload.canonical_base_url != null
      ? String(payload.canonical_base_url).trim().replace(/\/+$/, "")
      : current.canonical_base_url;
  const ga =
    payload.google_analytics_code != null
      ? String(payload.google_analytics_code)
      : current.google_analytics_code;
  const robots =
    payload.robots_txt != null ? String(payload.robots_txt) : current.robots_txt;
  const extras =
    payload.sitemap_extra_urls != null
      ? payload.sitemap_extra_urls
      : current.sitemap_extra_urls;

  if (current.id) {
    await pool.query(
      `UPDATE seo_settings
       SET site_name = :siteName,
           canonical_base_url = :baseUrl,
           google_analytics_code = :ga,
           robots_txt = :robots,
           sitemap_extra_urls = :extras
       WHERE id = :id`,
      {
        id: current.id,
        siteName,
        baseUrl,
        ga,
        robots,
        extras: JSON.stringify(extras || []),
      }
    );
    return getSeoSettings();
  }

  await pool.query(
    `INSERT INTO seo_settings
      (site_name, canonical_base_url, google_analytics_code, robots_txt, sitemap_extra_urls)
     VALUES
      (:siteName, :baseUrl, :ga, :robots, :extras)`,
    {
      siteName,
      baseUrl,
      ga,
      robots,
      extras: JSON.stringify(extras || []),
    }
  );
  return getSeoSettings();
}

async function listSeoPages({ includeInactive = true } = {}) {
  const where = includeInactive ? "" : "WHERE status = 'active'";
  const [rows] = await pool.query(
    `SELECT id, page_key, page_path, title, meta_description, meta_keywords,
            og_title, og_description, status, created_at, updated_at
     FROM seo_pages
     ${where}
     ORDER BY page_key ASC`
  );
  return rows;
}

async function getSeoPageByKeyOrPath({ pageKey, pagePath }) {
  if (pageKey) {
    const [rows] = await pool.query(
      `SELECT * FROM seo_pages WHERE page_key = :pageKey LIMIT 1`,
      { pageKey: String(pageKey).trim().toLowerCase() }
    );
    if (rows.length) return rows[0];
  }
  if (pagePath) {
    const path = normalizePath(pagePath);
    const [rows] = await pool.query(
      `SELECT * FROM seo_pages WHERE page_path = :pagePath AND status = 'active' LIMIT 1`,
      { pagePath: path }
    );
    if (rows.length) return rows[0];
  }
  return null;
}

function normalizePath(path) {
  let p = String(path || "/").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

async function upsertSeoPage(input) {
  const pageKey = String(input.page_key || input.pageKey || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const pagePath = normalizePath(input.page_path || input.pagePath || `/${pageKey}`);
  const title = String(input.title || "").trim();
  const metaDescription = String(input.meta_description || input.description || "").trim();
  const metaKeywords = String(input.meta_keywords || input.keywords || "").trim() || null;
  const ogTitle = String(input.og_title || input.ogTitle || title).trim() || null;
  const ogDescription =
    String(input.og_description || input.ogDescription || metaDescription).trim() || null;
  const status = ["active", "inactive"].includes(String(input.status || "").toLowerCase())
    ? String(input.status).toLowerCase()
    : "active";

  if (!pageKey || !title) {
    const err = new Error("page_key and title are required");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const [existing] = await pool.query(
    `SELECT id FROM seo_pages WHERE page_key = :pageKey LIMIT 1`,
    { pageKey }
  );

  if (existing.length) {
    await pool.query(
      `UPDATE seo_pages
       SET page_path = :pagePath,
           title = :title,
           meta_description = :metaDescription,
           meta_keywords = :metaKeywords,
           og_title = :ogTitle,
           og_description = :ogDescription,
           status = :status
       WHERE id = :id`,
      {
        id: existing[0].id,
        pagePath,
        title,
        metaDescription,
        metaKeywords,
        ogTitle,
        ogDescription,
        status,
      }
    );
    const [rows] = await pool.query(`SELECT * FROM seo_pages WHERE id = :id`, {
      id: existing[0].id,
    });
    return rows[0];
  }

  const [ins] = await pool.query(
    `INSERT INTO seo_pages
      (page_key, page_path, title, meta_description, meta_keywords, og_title, og_description, status)
     VALUES
      (:pageKey, :pagePath, :title, :metaDescription, :metaKeywords, :ogTitle, :ogDescription, :status)`,
    {
      pageKey,
      pagePath,
      title,
      metaDescription,
      metaKeywords,
      ogTitle,
      ogDescription,
      status,
    }
  );
  const [rows] = await pool.query(`SELECT * FROM seo_pages WHERE id = :id`, {
    id: ins.insertId,
  });
  return rows[0];
}

async function deleteSeoPage(id) {
  const [result] = await pool.query(`DELETE FROM seo_pages WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

async function buildSitemapXml() {
  const settings = await getSeoSettings();
  const base = String(settings.canonical_base_url || "").replace(/\/+$/, "") || "https://moneytrend.in";
  const pages = await listSeoPages({ includeInactive: false });
  const urls = new Set();

  urls.add(`${base}/`);
  for (const page of pages) {
    urls.add(`${base}${normalizePath(page.page_path)}`);
  }

  const [articles] = await pool.query(
    `SELECT id, type, updated_at FROM articles WHERE status = 'published' ORDER BY id DESC LIMIT 500`
  );
  for (const a of articles) {
    const segment = a.type === "news" ? "news" : "blogs";
    urls.add(`${base}/${segment}/${a.id}`);
  }

  for (const extra of settings.sitemap_extra_urls || []) {
    const u = String(extra || "").trim();
    if (!u) continue;
    if (/^https?:\/\//i.test(u)) urls.add(u.replace(/\/+$/, ""));
    else urls.add(`${base}${normalizePath(u)}`);
  }

  const now = new Date().toISOString();
  const body = [...urls]
    .map(
      (loc) => `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${now.slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

async function buildRobotsTxt() {
  const settings = await getSeoSettings();
  const base = String(settings.canonical_base_url || "").replace(/\/+$/, "") || "https://moneytrend.in";
  let text = settings.robots_txt || DEFAULT_ROBOTS;
  text = text.replace(/\{SITE_URL\}/g, base);
  if (!/sitemap:/i.test(text)) {
    text = `${text.trim()}\n\nSitemap: ${base}/sitemap.xml\n`;
  }
  return text;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function seedDefaultSeoPages() {
  const defaults = [
    { page_key: "home", page_path: "/", title: "Money Trend — FD, RD & Credit Insights", meta_description: "Compare bank FD & RD rates, check credit score, and invest smarter with Money Trend." },
    { page_key: "fd", page_path: "/fd", title: "Fixed Deposits | Money Trend", meta_description: "Compare and invest in Fixed Deposits across top banks." },
    { page_key: "rd", page_path: "/rd", title: "Recurring Deposits | Money Trend", meta_description: "Start Recurring Deposits with competitive bank rates." },
    { page_key: "credit_check", page_path: "/credit-check", title: "Credit Score & CIBIL Report | Money Trend", meta_description: "Check your credit score and download reports securely." },
    { page_key: "blogs", page_path: "/blogs", title: "Blogs | Money Trend", meta_description: "Financial tips, FD/RD guides, and credit education." },
    { page_key: "news", page_path: "/news", title: "News | Money Trend", meta_description: "Latest finance and banking news." },
  ];
  for (const d of defaults) {
    const [existing] = await pool.query(
      `SELECT id FROM seo_pages WHERE page_key = :pageKey LIMIT 1`,
      { pageKey: d.page_key }
    );
    if (!existing.length) {
      await upsertSeoPage(d);
    }
  }
  const settings = await getSeoSettings();
  if (!settings.id) {
    await upsertSeoSettings({
      site_name: "Money Trend",
      canonical_base_url: process.env.FRONTEND_ORIGIN || "https://moneytrend.in",
      google_analytics_code: "",
      robots_txt: DEFAULT_ROBOTS,
      sitemap_extra_urls: [],
    });
  }
}

module.exports = {
  getSeoSettings,
  upsertSeoSettings,
  listSeoPages,
  getSeoPageByKeyOrPath,
  upsertSeoPage,
  deleteSeoPage,
  buildSitemapXml,
  buildRobotsTxt,
  seedDefaultSeoPages,
};
