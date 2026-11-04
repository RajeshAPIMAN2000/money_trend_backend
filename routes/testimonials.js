const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  getMyTestimonial,
  listTestimonialsPublic,
  createUserTestimonial,
} = require("../controllers/testimonialController");

const router = express.Router();

/** Public — website testimonials section (no token) */
router.get("/", listTestimonialsPublic);

/** Authenticated user — check their submission status */
router.get("/me", authenticate, getMyTestimonial);

/** Authenticated user — submit review */
router.post("/", authenticate, createUserTestimonial);

module.exports = router;
