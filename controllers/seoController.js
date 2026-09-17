const { writeAuditLog } = require("../utils/audit");
const {
  getSeoSettings,
  upsertSeoSettings,
  listSeoPages,
  getSeoPageByKeyOrPath,
  upsertSeoPage,
  deleteSeoPage,
  buildSitemapXml,
  buildRobotsTxt,
} = require("../services/seoService");

/** Public: page meta for frontend helmet / head tags */
async function getPublicPageSeo(req, res) {
  try {
    const pageKey = req.query.page_key || req.query.key || null;
    const pagePath = req.query.path || req.query.page_path || null;
    const settings = await getSeoSettings();
    const page = await getSeoPageByKeyOrPath({ pageKey, pagePath });

    return res.json({
      success: true,
      data: {
        site_name: settings.site_name,
        canonical_base_url: settings.canonical_base_url,
        google_analytics_code: settings.google_analytics_code || "",
        page: page
          ? {
              page_key: page.page_key,
              page_path: page.page_path,
              title: page.title,
              description: page.meta_description,
              meta_description: page.meta_description,
              meta_keywords: page.meta_keywords,
              og_title: page.og_title || page.title,
              og_description: page.og_description || page.meta_description,
            }
          : null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getPublicAnalytics(req, res) {
  try {
    const settings = await getSeoSettings();
    return res.json({
      success: true,
      data: {
        google_analytics_code: settings.google_analytics_code || "",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function serveSitemap(req, res) {
  try {
    const xml = await buildSitemapXml();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(xml);
  } catch (error) {
    return res.status(500).type("text").send("Failed to build sitemap");
  }
}

async function serveRobots(req, res) {
  try {
    const text = await buildRobotsTxt();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(text);
  } catch (error) {
    return res.status(500).type("text").send("Failed to build robots.txt");
  }
}

async function adminGetSeoSettings(req, res) {
  try {
    const data = await getSeoSettings();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function adminUpdateSeoSettings(req, res) {
  try {
    const data = await upsertSeoSettings({
      site_name: req.body.site_name || req.body.siteName,
      canonical_base_url: req.body.canonical_base_url || req.body.canonicalBaseUrl || req.body.site_url,
      google_analytics_code:
        req.body.google_analytics_code ??
        req.body.googleAnalyticsCode ??
        req.body.ga_code ??
        req.body.analytics_code,
      robots_txt: req.body.robots_txt ?? req.body.robotsTxt,
      sitemap_extra_urls: req.body.sitemap_extra_urls || req.body.sitemapExtraUrls,
    });

    await writeAuditLog({
      userId: req.user.id,
      action: "SEO_SETTINGS_UPDATED",
      entityType: "seo_settings",
      entityId: data.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: "SEO settings updated (GA, robots, sitemap base)",
      data,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function adminListSeoPages(req, res) {
  try {
    const pages = await listSeoPages({ includeInactive: true });
    return res.json({
      success: true,
      message: "SEO pages fetched",
      data: { count: pages.length, pages },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function adminUpsertSeoPage(req, res) {
  try {
    const body = { ...req.body };
    if (req.params.id && !body.page_key && !body.pageKey) {
      const id = Number(req.params.id);
      const pool = require("../config/db");
      const [rows] = await pool.query(`SELECT page_key FROM seo_pages WHERE id = :id LIMIT 1`, {
        id,
      });
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "SEO page not found" });
      }
      body.page_key = rows[0].page_key;
    }
    const page = await upsertSeoPage(body);
    await writeAuditLog({
      userId: req.user.id,
      action: "SEO_PAGE_UPSERTED",
      entityType: "seo_page",
      entityId: page.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { page_key: page.page_key },
    });
    return res.json({
      success: true,
      message: "SEO page title/description saved",
      data: page,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
}

async function adminDeleteSeoPage(req, res) {
  try {
    const id = Number(req.params.id);
    const ok = await deleteSeoPage(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: "SEO page not found" });
    }
    await writeAuditLog({
      userId: req.user.id,
      action: "SEO_PAGE_DELETED",
      entityType: "seo_page",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.json({ success: true, message: "SEO page deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  getPublicPageSeo,
  getPublicAnalytics,
  serveSitemap,
  serveRobots,
  adminGetSeoSettings,
  adminUpdateSeoSettings,
  adminListSeoPages,
  adminUpsertSeoPage,
  adminDeleteSeoPage,
};
