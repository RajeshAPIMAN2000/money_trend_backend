const express = require("express");
const {
  getPublicPageSeo,
  getPublicAnalytics,
  serveSitemap,
  serveRobots,
} = require("../controllers/seoController");

const router = express.Router();

/** Public SEO helpers for frontend */
router.get("/page", getPublicPageSeo);
router.get("/analytics", getPublicAnalytics);
router.get("/sitemap.xml", serveSitemap);
router.get("/robots.txt", serveRobots);

module.exports = router;
