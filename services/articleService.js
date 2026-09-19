const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");
const { writeAuditLog } = require("../utils/audit");
const { isFullAdmin } = require("./staffPermissionService");

const ARTICLE_TYPES = ["blog", "news"];
const ARTICLE_STATUSES = ["draft", "pending", "published", "rejected"];

/** Common categories for admin UI dropdowns */
const ARTICLE_CATEGORIES = [
  "Market Updates",
  "FD & RD",
  "Credit Score",
  "Personal Finance",
  "Tax",
  "Banking",
  "Investment Tips",
  "Company News",
  "General",
];

function publicBaseUrl() {
  return String(
    process.env.PUBLIC_BASE_URL ||
      process.env.APP_URL ||
      process.env.API_PUBLIC_URL ||
      ""
  )
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
}

function formatImageUrl(image) {
  if (!image) return null;
  const value = String(image).trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  const path = value.startsWith("/uploads/")
    ? value
    : `/uploads/${value.replace(/^\/+/, "")}`;
  const base = publicBaseUrl();
  return base ? `${base}${path}` : path;
}

/** Store relative filename/path in DB (not absolute URL). */
function normalizeImageForDb(image) {
  if (!image) return null;
  let value = String(image).trim();
  if (!value) return null;
  value = value.replace(/^https?:\/\/[^/]+/i, "");
  if (value.startsWith("/uploads/")) return value.replace(/^\/uploads\//, "");
  return value.replace(/^\/+/, "");
}

/**
 * Accept category from many frontend field names / shapes
 * (JSON, multipart FormData, arrays, objects).
 */
function extractCategory(body = {}) {
  const raw =
    body.category ??
    body.categories ??
    body.cat ??
    body.category_name ??
    body.categoryName ??
    body.blog_category ??
    body.blogCategory ??
    body.news_category ??
    body.newsCategory ??
    body.article_category ??
    body.articleCategory ??
    body.tag ??
    body.tags;

  if (raw == null || raw === "") return null;

  if (Array.isArray(raw)) {
    const joined = raw
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "object") return item.name || item.label || item.value || item.title || "";
        return String(item);
      })
      .filter(Boolean)
      .join(", ");
    return sanitizeText(joined, 100) || null;
  }

  if (typeof raw === "object") {
    return (
      sanitizeText(raw.name || raw.label || raw.value || raw.title || raw.category || "", 100) ||
      null
    );
  }

  const text = String(raw).trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return extractCategory({ category: parsed });
    } catch (_e) {
      // keep as plain text
    }
  }

  return sanitizeText(text, 100) || null;
}

function mapArticle(row, { includeStatus = false } = {}) {
  if (!row) return null;
  const authorName = row.author_name || row.full_name || row.author || null;
  const item = {
    id: row.id,
    type: row.type,
    heading: row.heading,
    title: row.heading,
    description: row.description,
    category: row.category || null,
    image: formatImageUrl(row.image),
    author_id: row.created_by != null ? Number(row.created_by) : null,
    author_name: authorName ? String(authorName) : null,
    author: authorName ? String(authorName) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeStatus) {
    item.status = row.status;
    item.created_by = row.created_by != null ? Number(row.created_by) : null;
    item.rejection_reason = row.rejection_reason || null;
    item.reviewed_by = row.reviewed_by != null ? Number(row.reviewed_by) : null;
    item.reviewed_at = row.reviewed_at || null;
    item.submitted_at = row.submitted_at || null;
    item.reviewer_name = row.reviewer_name || null;
  }
  return item;
}

const ARTICLE_SELECT = `
  a.id, a.type, a.heading, a.description, a.category, a.image, a.status,
  a.rejection_reason, a.reviewed_by, a.reviewed_at, a.submitted_at,
  a.created_by, a.created_at, a.updated_at,
  u.full_name AS author_name,
  r.full_name AS reviewer_name
`;

const ARTICLE_FROM = `
  FROM articles a
  LEFT JOIN users u ON u.id = a.created_by
  LEFT JOIN users r ON r.id = a.reviewed_by
`;

function validateArticleInput(body, { requireImage = false, isUpdate = false } = {}) {
  const errors = [];
  const heading = sanitizeText(body.heading || body.title, 255);
  const description = sanitizeText(body.description || body.content, 10000);
  const category = extractCategory(body);
  // type is ALWAYS forced by the route (blog vs news) — ignore body.type to prevent mix-ups
  const statusRaw = body.status != null ? String(body.status).toLowerCase() : null;

  if (!isUpdate && !heading) errors.push("heading is required");
  if (!isUpdate && !description) errors.push("description is required");
  if (statusRaw && !ARTICLE_STATUSES.includes(statusRaw)) {
    errors.push(`status must be one of: ${ARTICLE_STATUSES.join(", ")}`);
  }
  if (requireImage && !body.image && !body.image_url) {
    errors.push("image is required");
  }

  return {
    errors,
    data: {
      heading,
      description,
      category: category || null,
      status: statusRaw && ARTICLE_STATUSES.includes(statusRaw) ? statusRaw : null,
      image: body.image || body.image_url || null,
    },
  };
}

function assertOwnership(existing, actor) {
  if (isFullAdmin(actor)) return;
  if (Number(existing.created_by) !== Number(actor.id)) {
    const err = new Error("You can only manage your own posts");
    err.code = "FORBIDDEN";
    throw err;
  }
}

async function listAdmin(type, { status, category, limit = 50, offset = 0, actor = null } = {}) {
  const conditions = ["a.type = :type"];
  const params = { type };
  if (status) {
    conditions.push("a.status = :status");
    params.status = status;
  }
  if (category) {
    conditions.push("a.category = :category");
    params.category = String(category).trim();
  }
  // Sub Admin sees only their own posts
  if (actor && !isFullAdmin(actor)) {
    conditions.push("a.created_by = :createdBy");
    params.createdBy = Number(actor.id);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return rows.map((r) => mapArticle(r, { includeStatus: true }));
}

async function listPublished(type, { limit = 20, offset = 0, category } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const conditions = ["a.type = :type", "a.status = 'published'"];
  const params = { type };
  if (category) {
    conditions.push("a.category = :category");
    params.category = String(category).trim();
  }

  const [rows] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM articles a WHERE ${conditions.join(" AND ")}`,
    params
  );

  return {
    items: rows.map((r) => mapArticle(r)),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function listDistinctCategories(type = null) {
  const params = {};
  let where = "category IS NOT NULL AND category <> ''";
  if (type) {
    where += " AND type = :type";
    params.type = type;
  }
  const [rows] = await pool.query(
    `SELECT DISTINCT category FROM articles WHERE ${where} ORDER BY category ASC`,
    params
  );
  const fromDb = rows.map((r) => r.category).filter(Boolean);
  return [...new Set([...ARTICLE_CATEGORIES, ...fromDb])];
}

async function getPublishedById(id, type) {
  const [rows] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE a.id = :id AND a.type = :type AND a.status = 'published'
     LIMIT 1`,
    { id, type }
  );
  return rows.length ? mapArticle(rows[0]) : null;
}

async function getAdminById(id, type) {
  const [rows] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE a.id = :id AND a.type = :type
     LIMIT 1`,
    { id, type }
  );
  return rows.length ? mapArticle(rows[0], { includeStatus: true }) : null;
}

/**
 * Create blog/news.
 * - type is ALWAYS from the route (blog|news) — never from body (prevents mix-up)
 * - Sub Admin → status forced to pending (awaits Admin approval)
 * - Admin → draft | published | pending (default published)
 */
async function createArticle(type, body, actor, reqMeta = {}) {
  const lockedType = type === "news" ? "news" : "blog";
  const validation = validateArticleInput({ ...body, type: lockedType });
  if (validation.errors.length) {
    const err = new Error(validation.errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = validation.errors;
    throw err;
  }

  let createdBy = actor?.id != null ? Number(actor.id) : null;
  if (!Number.isFinite(createdBy) || createdBy <= 0) createdBy = null;

  if (createdBy) {
    const [users] = await pool.query(`SELECT id FROM users WHERE id = :id LIMIT 1`, {
      id: createdBy,
    });
    if (!users.length) {
      console.warn("[ARTICLE] created_by user missing; inserting with NULL", { createdBy });
      createdBy = null;
    }
  }

  const isAdmin = isFullAdmin(actor);
  let status;
  if (!isAdmin) {
    status = "pending";
  } else {
    status = validation.data.status || "published";
    if (!ARTICLE_STATUSES.includes(status)) status = "published";
  }

  const image = normalizeImageForDb(validation.data.image);

  const [result] = await pool.query(
    `INSERT INTO articles
      (type, heading, description, category, image, status, created_by, submitted_at)
     VALUES
      (:type, :heading, :description, :category, :image, :status, :createdBy,
       ${status === "pending" ? "NOW()" : "NULL"})`,
    {
      type: lockedType,
      heading: validation.data.heading,
      description: validation.data.description,
      category: validation.data.category,
      image,
      status,
      createdBy,
    }
  );

  await writeAuditLog({
    userId: createdBy,
    action: "ARTICLE_CREATED",
    entityType: lockedType,
    entityId: result.insertId,
    ipAddress: reqMeta.ip,
    meta: { heading: validation.data.heading, status },
  });

  return getAdminById(result.insertId, lockedType);
}

/**
 * Update blog/news.
 * Sub Admin: own posts only; cannot publish; rejected/draft edit → pending (resubmit).
 * Admin: full control; type never changes from route.
 */
async function updateArticle(id, type, body, actor, reqMeta = {}) {
  const lockedType = type === "news" ? "news" : "blog";
  const existing = await getAdminById(id, lockedType);
  if (!existing) {
    const err = new Error(`${lockedType === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  assertOwnership(existing, actor);
  const isAdmin = isFullAdmin(actor);

  const { errors, data } = validateArticleInput(
    {
      heading: body.heading ?? body.title ?? existing.heading,
      description: body.description ?? body.content ?? existing.description,
      ...body,
      category: extractCategory(body) ?? existing.category,
      status: body.status ?? existing.status,
      image: body.image ?? body.image_url ?? existing.image,
      type: lockedType,
    },
    { isUpdate: true }
  );

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let nextStatus = data.status || existing.status;
  let clearRejection = false;
  let setSubmittedAt = false;

  const wantsResubmit =
    body.resubmit === true ||
    body.resubmit === "true" ||
    body.submit_for_approval === true ||
    body.submit_for_approval === "true";

  if (!isAdmin) {
    // Sub Admin cannot self-publish
    if (nextStatus === "published") nextStatus = "pending";
    if (existing.status === "rejected" || wantsResubmit || existing.status === "draft") {
      nextStatus = "pending";
      clearRejection = true;
      setSubmittedAt = true;
    } else if (existing.status === "pending") {
      nextStatus = "pending";
    } else if (existing.status === "published") {
      // Sub Admin editing a live post sends it back for re-approval
      nextStatus = "pending";
      setSubmittedAt = true;
    }
  } else if (wantsResubmit) {
    nextStatus = "pending";
    clearRejection = true;
    setSubmittedAt = true;
  }

  const image = normalizeImageForDb(data.image || existing.image);

  await pool.query(
    `UPDATE articles SET
      heading = :heading,
      description = :description,
      category = :category,
      image = :image,
      status = :status,
      rejection_reason = ${clearRejection ? "NULL" : "rejection_reason"},
      reviewed_by = ${clearRejection ? "NULL" : "reviewed_by"},
      reviewed_at = ${clearRejection ? "NULL" : "reviewed_at"},
      submitted_at = ${setSubmittedAt ? "NOW()" : "submitted_at"},
      updated_at = NOW()
     WHERE id = :id AND type = :type`,
    {
      id,
      type: lockedType,
      heading: data.heading || existing.heading,
      description: data.description || existing.description,
      category: data.category ?? existing.category ?? null,
      image,
      status: nextStatus,
    }
  );

  await writeAuditLog({
    userId: actor?.id,
    action: "ARTICLE_UPDATED",
    entityType: lockedType,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: data.heading, status: nextStatus },
  });

  return getAdminById(id, lockedType);
}

async function deleteArticle(id, type, actor, reqMeta = {}) {
  const lockedType = type === "news" ? "news" : "blog";
  const existing = await getAdminById(id, lockedType);
  if (!existing) {
    const err = new Error(`${lockedType === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  assertOwnership(existing, actor);

  await pool.query(`DELETE FROM articles WHERE id = :id AND type = :type`, {
    id,
    type: lockedType,
  });

  await writeAuditLog({
    userId: actor?.id,
    action: "ARTICLE_DELETED",
    entityType: lockedType,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: existing.heading },
  });

  return { id, deleted: true, type: lockedType };
}

/** Admin approves → published (live on public site). */
async function approveArticle(id, type, actor, reqMeta = {}) {
  if (!isFullAdmin(actor)) {
    const err = new Error("Only Admin can approve posts");
    err.code = "FORBIDDEN";
    throw err;
  }
  const lockedType = type === "news" ? "news" : "blog";
  const existing = await getAdminById(id, lockedType);
  if (!existing) {
    const err = new Error(`${lockedType === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(
    `UPDATE articles SET
      status = 'published',
      rejection_reason = NULL,
      reviewed_by = :reviewedBy,
      reviewed_at = NOW(),
      updated_at = NOW()
     WHERE id = :id AND type = :type`,
    { id, type: lockedType, reviewedBy: Number(actor.id) }
  );

  await writeAuditLog({
    userId: actor.id,
    action: "ARTICLE_APPROVED",
    entityType: lockedType,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: existing.heading },
  });

  return getAdminById(id, lockedType);
}

/** Admin rejects → rejected + reason (Sub Admin can edit & resubmit). */
async function rejectArticle(id, type, actor, reason, reqMeta = {}) {
  if (!isFullAdmin(actor)) {
    const err = new Error("Only Admin can reject posts");
    err.code = "FORBIDDEN";
    throw err;
  }
  const lockedType = type === "news" ? "news" : "blog";
  const existing = await getAdminById(id, lockedType);
  if (!existing) {
    const err = new Error(`${lockedType === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  const rejectionReason = sanitizeText(reason || "", 2000);
  if (!rejectionReason) {
    const err = new Error("rejection reason is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  await pool.query(
    `UPDATE articles SET
      status = 'rejected',
      rejection_reason = :reason,
      reviewed_by = :reviewedBy,
      reviewed_at = NOW(),
      updated_at = NOW()
     WHERE id = :id AND type = :type`,
    {
      id,
      type: lockedType,
      reason: rejectionReason,
      reviewedBy: Number(actor.id),
    }
  );

  await writeAuditLog({
    userId: actor.id,
    action: "ARTICLE_REJECTED",
    entityType: lockedType,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: existing.heading, reason: rejectionReason },
  });

  return getAdminById(id, lockedType);
}

async function getLatestInsights(limit = 3) {
  const safeLimit = Math.min(Number(limit) || 3, 10);
  const [blogs] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE a.type = 'blog' AND a.status = 'published'
     ORDER BY a.created_at DESC
     LIMIT ${safeLimit}`
  );
  const [news] = await pool.query(
    `SELECT ${ARTICLE_SELECT}
     ${ARTICLE_FROM}
     WHERE a.type = 'news' AND a.status = 'published'
     ORDER BY a.created_at DESC
     LIMIT ${safeLimit}`
  );

  return {
    blogs: blogs.map((r) => mapArticle(r)),
    news: news.map((r) => mapArticle(r)),
  };
}

module.exports = {
  ARTICLE_TYPES,
  ARTICLE_STATUSES,
  ARTICLE_CATEGORIES,
  extractCategory,
  formatImageUrl,
  listPublished,
  getPublishedById,
  listAdmin,
  listDistinctCategories,
  getAdminById,
  createArticle,
  updateArticle,
  deleteArticle,
  approveArticle,
  rejectArticle,
  getLatestInsights,
};
