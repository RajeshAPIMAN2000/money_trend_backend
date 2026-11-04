const express = require("express");
const { listBanners, getBannerById } = require("../controllers/bannerController");

const router = express.Router();

// Public — no login required
router.get("/", listBanners);
router.get("/:id", getBannerById);

module.exports = router;
