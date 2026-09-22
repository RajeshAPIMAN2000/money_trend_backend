const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  listTestimonialsPublic,
  createUserTestimonial,
} = require("../controllers/testimonialController");

const router = express.Router();

/** Public — website testimonials section (no token) */
router.get("/", listTestimonialsPublic);

/** Authenticated user — submit review */
router.post("/", authenticate, createUserTestimonial);

module.exports = router;
