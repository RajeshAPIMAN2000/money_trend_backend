const express = require("express");
const {
  getHome,
  getHomeProducts,
  getHomeCompare,
  getHomeDashboard,
  getHomeFull,
} = require("../controllers/homeController");

const router = express.Router();

// All home routes are public — no JWT required.
// Send Bearer token optionally on /compare, /dashboard, /full to show logged-in user details.
router.get("/", getHome);
router.get("/products", getHomeProducts);
router.get("/compare", getHomeCompare);
router.get("/full", getHomeFull);
router.get("/dashboard", getHomeDashboard);

module.exports = router;
