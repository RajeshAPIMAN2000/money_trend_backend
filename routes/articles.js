const express = require("express");
const { upload } = require("../middleware/upload");
const {
  listBlogs,
  getBlogById,
  listNews,
  getNewsById,
} = require("../controllers/articleController");

const router = express.Router();

// Public — no login required
router.get("/blogs", listBlogs);
router.get("/blogs/:id", getBlogById);
router.get("/news", listNews);
router.get("/news/:id", getNewsById);

module.exports = router;
