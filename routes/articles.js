const express = require("express");
const {
  listBlogs,
  getBlogById,
  listNews,
  getNewsById,
  listArticleCategories,
} = require("../controllers/articleController");

const router = express.Router();

// Public — no login required
router.get("/categories", listArticleCategories);
router.get("/blogs", listBlogs);
router.get("/blogs/:id", getBlogById);
router.get("/news", listNews);
router.get("/news/:id", getNewsById);

module.exports = router;
