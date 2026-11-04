const pool = require("../config/db");

const PAYMENT_STATUSES = new Set([
  "created",
  "pending",
  "authorized",
  "success",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
const VERIFICATION_STATUSES = new Set(["pending", "verified", "rejected"]);

function parsePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function listCivilScorePayments(query = {}) {
  const page = parsePositiveInteger(query.page, 1);
  const pageSize = parsePositiveInteger(query.page_size ?? query.pageSize, 25, 100);
  const offset = (page - 1) * pageSize;
  const search = String(query.search || "").trim().slice(0, 150);
  const paymentStatus = String(query.payment_status || query.paymentStatus || "").trim().toLowerCase();
  const verificationStatus = String(
    query.verification_status || query.verificationStatus || ""
  ).trim().toLowerCase();

  if (paymentStatus && !PAYMENT_STATUSES.has(paymentStatus)) {
    const error = new Error("Invalid payment status filter");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (verificationStatus && !VERIFICATION_STATUSES.has(verificationStatus)) {
    const error = new Error("Invalid verification status filter");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const where = [];
  const params = { limit: pageSize, offset };
  if (search) {
    where.push(`(
      CAST(p.id AS CHAR) LIKE :search OR
      CAST(p.user_id AS CHAR) LIKE :search OR
      p.report_ref LIKE :search OR
      p.provider LIKE :search OR
      p.razorpay_order_id LIKE :search OR
      p.razorpay_payment_id LIKE :search OR
      u.full_name LIKE :search OR
      u.email LIKE :search OR
      u.phone LIKE :search
    )`);
    params.search = `%${search}%`;
  }
  if (paymentStatus) {
    where.push("p.payment_status = :paymentStatus");
    params.paymentStatus = paymentStatus;
  }
  if (verificationStatus) {
    where.push("p.verification_status = :verificationStatus");
    params.verificationStatus = verificationStatus;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM civil_score_payments p
     LEFT JOIN users u ON u.id = p.user_id
     ${whereSql}`,
    params
  );
  const [items] = await pool.query(
    `SELECT p.id, p.user_id, p.report_ref, p.provider, p.amount_paise, p.currency,
            p.razorpay_order_id, p.razorpay_payment_id, p.razorpay_signature,
            p.payment_status, p.verification_status, p.report_downloaded,
            p.download_count, p.first_downloaded_at, p.last_downloaded_at,
            p.failure_reason, p.refund_amount_paise, p.admin_notes, p.verified_by,
            p.verified_at, p.created_at, p.updated_at,
            u.full_name AS user_full_name, u.email AS user_email, u.phone AS user_phone
     FROM civil_score_payments p
     LEFT JOIN users u ON u.id = p.user_id
     ${whereSql}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT :limit OFFSET :offset`,
    params
  );

  const [[stats]] = await pool.query(`
    SELECT COUNT(*) AS total_count,
           SUM(payment_status = 'success' AND verification_status = 'verified') AS successful_count,
           SUM(payment_status IN ('created', 'pending', 'authorized')) AS pending_count,
           SUM(payment_status IN ('failed', 'cancelled')) AS failed_count,
           SUM(payment_status IN ('refunded', 'partially_refunded')) AS refunded_count,
           COALESCE(SUM(
             CASE WHEN payment_status = 'success' AND verification_status = 'verified'
               THEN amount_paise ELSE 0 END
           ), 0) AS successful_amount_paise
    FROM civil_score_payments
  `);

  const total = Number(countRow?.total || 0);
  return {
    items,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    },
    stats: {
      total_count: Number(stats?.total_count || 0),
      successful_count: Number(stats?.successful_count || 0),
      pending_count: Number(stats?.pending_count || 0),
      failed_count: Number(stats?.failed_count || 0),
      refunded_count: Number(stats?.refunded_count || 0),
      successful_amount_paise: Number(stats?.successful_amount_paise || 0),
    },
  };
}

module.exports = { listCivilScorePayments };
