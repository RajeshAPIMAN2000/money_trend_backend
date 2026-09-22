const {
  createTestimonial,
  listPublicTestimonials,
  listAdminTestimonials,
  deleteTestimonial,
} = require("../services/testimonialService");

function handleTestimonialError(res, error, fallback) {
  if (error.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.code === "VALIDATION_ERROR") {
    return res.status(400).json({
      success: false,
      message: error.message,
      errorCode: "VALIDATION_ERROR",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({
    success: false,
    message: fallback,
    error: error.message,
  });
}

/** GET /api/testimonials — public (no token) */
async function listTestimonialsPublic(req, res) {
  try {
    const data = await listPublicTestimonials({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      success: true,
      message: "Testimonials fetched",
      data,
    });
  } catch (error) {
    return handleTestimonialError(res, error, "Failed to fetch testimonials");
  }
}

/** POST /api/testimonials — authenticated user */
async function createUserTestimonial(req, res) {
  try {
    const data = await createTestimonial(req.user.id, req.body || {});
    return res.status(201).json({
      success: true,
      message: "Testimonial submitted successfully",
      data,
    });
  } catch (error) {
    return handleTestimonialError(res, error, "Failed to submit testimonial");
  }
}

/** GET /api/admin/testimonials */
async function adminListTestimonials(req, res) {
  try {
    const data = await listAdminTestimonials({
      limit: req.query.limit,
      offset: req.query.offset,
      status: req.query.status,
    });
    return res.json({
      success: true,
      message: "Admin testimonials list",
      data,
    });
  } catch (error) {
    return handleTestimonialError(res, error, "Failed to list testimonials");
  }
}

/** DELETE /api/admin/testimonials/:id */
async function adminDeleteTestimonial(req, res) {
  try {
    const data = await deleteTestimonial(req.params.id);
    return res.json({
      success: true,
      message: "Testimonial deleted",
      data,
    });
  } catch (error) {
    return handleTestimonialError(res, error, "Failed to delete testimonial");
  }
}

module.exports = {
  listTestimonialsPublic,
  createUserTestimonial,
  adminListTestimonials,
  adminDeleteTestimonial,
};
