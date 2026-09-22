const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");

function formatPublicTestimonial(row) {
  return {
    id: Number(row.id),
    rating: Number(row.rating),
    description: row.description,
    user_name: row.full_name || "Money Trend User",
    profile_image: row.profile_image || null,
    created_at: row.created_at,
  };
}

function formatAdminTestimonial(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    rating: Number(row.rating),
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: {
      id: Number(row.user_id),
      full_name: row.full_name || null,
      email: row.email || null,
      phone: row.phone || null,
      profile_image: row.profile_image || null,
    },
  };
}

async function createTestimonial(userId, body) {
  const rating = Number(body.rating);
  const description = sanitizeText(body.description || body.review || body.message, 1000);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const err = new Error("Rating must be an integer from 1 to 5");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (!description || description.length < 10) {
    const err = new Error("Description must be at least 10 characters");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const [ins] = await pool.query(
    `INSERT INTO testimonials (user_id, rating, description, status)
     VALUES (:userId, :rating, :description, 'active')`,
    { userId, rating, description }
  );

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name, u.profile_image
     FROM testimonials t
     JOIN users u ON u.id = t.user_id
     WHERE t.id = :id
     LIMIT 1`,
    { id: ins.insertId }
  );

  return formatPublicTestimonial(rows[0]);
}

async function listPublicTestimonials({ limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS total, ROUND(AVG(rating), 2) AS average_rating
     FROM testimonials WHERE status = 'active'`
  );

  const [rows] = await pool.query(
    `SELECT t.id, t.rating, t.description, t.created_at, u.full_name, u.profile_image
     FROM testimonials t
     JOIN users u ON u.id = t.user_id
     WHERE t.status = 'active'
     ORDER BY t.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`
  );

  return {
    summary: {
      total: Number(stats.total || 0),
      average_rating: Number(stats.average_rating || 0),
    },
    count: rows.length,
    testimonials: rows.map(formatPublicTestimonial),
  };
}

async function listAdminTestimonials({ limit = 50, offset = 0, status } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let where = "WHERE 1=1";
  const params = {};
  if (status) {
    where += " AND t.status = :status";
    params.status = String(status).toLowerCase();
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM testimonials t ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name, u.email, u.phone, u.profile_image
     FROM testimonials t
     JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY t.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    summary: { total: Number(countRows[0]?.total || 0) },
    count: rows.length,
    testimonials: rows.map(formatAdminTestimonial),
  };
}

async function deleteTestimonial(id) {
  const testimonialId = Number(id);
  if (!testimonialId) {
    const err = new Error("Valid testimonial id is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const [rows] = await pool.query(`SELECT id FROM testimonials WHERE id = :id LIMIT 1`, {
    id: testimonialId,
  });
  if (!rows.length) {
    const err = new Error("Testimonial not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(`DELETE FROM testimonials WHERE id = :id`, { id: testimonialId });
  return { deleted: true, testimonial_id: testimonialId };
}

module.exports = {
  createTestimonial,
  listPublicTestimonials,
  listAdminTestimonials,
  deleteTestimonial,
};
