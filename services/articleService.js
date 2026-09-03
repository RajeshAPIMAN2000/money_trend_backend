const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");
const { writeAuditLog } = require("../utils/audit");

const ARTICLE_TYPES = ["blog", "news"];

function formatImageUrl(image) {
  if (!image) return null;
  const value = String(image).trim();
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/uploads/")) {
    return value;
  }
  return `/uploads/${value.replace(/^\/+/, "")}`;
}

function mapArticle(row, { includeStatus = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    type: row.type,
    heading: row.heading,
    description: row.description,
    image: formatImageUrl(row.image),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeStatus) {
    item.status = row.status;
    item.created_by = row.created_by;
  }
  return item;
}

function validateArticleInput(body, { requireImage = false, isUpdate = false } = {}) {
  const errors = [];
  const heading = sanitizeText(body.heading || body.title, 255);
  const description = sanitizeText(body.description || body.content, 10000);
  const type = String(body.type || "").toLowerCase();
  const status = String(body.status || "published").toLowerCase();

  if (!isUpdate && !heading) errors.push("heading is required");
  if (!isUpdate && !description) errors.push("description is required");
  if (!isUpdate && type && !ARTICLE_TYPES.includes(type)) {
    errors.push("type must be blog or news");
  }
  if (status && !["draft", "published"].includes(status)) {
    errors.push("status must be draft or published");
  }
  if (requireImage && !body.image && !body.image_url) {
    errors.push("image is required");
  }

  return {
    errors,
    data: {
      heading,
      description,
      type: ARTICLE_TYPES.includes(type) ? type : null,
      status: ["draft", "published"].includes(status) ? status : "published",
      image: body.image || body.image_url || null,
    },
  };
}

async function listPublished(type, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT id, type, heading, description, image, created_at, updated_at
     FROM articles
     WHERE type = :type AND status = 'published'
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    { type }
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE type = :type AND status = 'published'`,
    { type }
  );

  return {
    items: rows.map((r) => mapArticle(r)),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getPublishedById(id, type) {
  const [rows] = await pool.query(
    `SELECT id, type, heading, description, image, created_at, updated_at
     FROM articles
     WHERE id = :id AND type = :type AND status = 'published'
     LIMIT 1`,
    { id, type }
  );
  return rows.length ? mapArticle(rows[0]) : null;
}

async function listAdmin(type, { status, limit = 50, offset = 0 } = {}) {
  const conditions = ["type = :type"];
  const params = { type };
  if (status) {
    conditions.push("status = :status");
    params.status = status;
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT id, type, heading, description, image, status, created_by, created_at, updated_at
     FROM articles
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return rows.map((r) => mapArticle(r, { includeStatus: true }));
}

async function getAdminById(id, type) {
  const [rows] = await pool.query(
    `SELECT id, type, heading, description, image, status, created_by, created_at, updated_at
     FROM articles WHERE id = :id AND type = :type LIMIT 1`,
    { id, type }
  );
  return rows.length ? mapArticle(rows[0], { includeStatus: true }) : null;
}

async function createArticle(type, body, adminUserId, reqMeta = {}) {
  const validation = validateArticleInput({ ...body, type }, { requireImage: false });
  if (validation.errors.length) {
    const err = new Error(validation.errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = validation.errors;
    throw err;
  }

  const [result] = await pool.query(
    `INSERT INTO articles (type, heading, description, image, status, created_by)
     VALUES (:type, :heading, :description, :image, :status, :createdBy)`,
    {
      type,
      heading: validation.data.heading,
      description: validation.data.description,
      image: validation.data.image,
      status: validation.data.status,
      createdBy: adminUserId,
    }
  );

  await writeAuditLog({
    userId: adminUserId,
    action: "ARTICLE_CREATED",
    entityType: type,
    entityId: result.insertId,
    ipAddress: reqMeta.ip,
    meta: { heading: validation.data.heading },
  });

  return getAdminById(result.insertId, type);
}

async function updateArticle(id, type, body, adminUserId, reqMeta = {}) {
  const existing = await getAdminById(id, type);
  if (!existing) {
    const err = new Error(`${type === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  const { errors, data } = validateArticleInput(
    {
      heading: body.heading ?? existing.heading,
      description: body.description ?? existing.description,
      status: body.status ?? existing.status,
      image: body.image ?? body.image_url ?? existing.image?.replace("/uploads/", ""),
      type,
    },
    { isUpdate: true }
  );

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  await pool.query(
    `UPDATE articles SET
      heading = :heading,
      description = :description,
      image = :image,
      status = :status,
      updated_at = NOW()
     WHERE id = :id AND type = :type`,
    {
      id,
      type,
      heading: data.heading || existing.heading,
      description: data.description || existing.description,
      image: data.image || existing.image?.replace("/uploads/", "") || null,
      status: data.status || existing.status,
    }
  );

  await writeAuditLog({
    userId: adminUserId,
    action: "ARTICLE_UPDATED",
    entityType: type,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: data.heading },
  });

  return getAdminById(id, type);
}

async function deleteArticle(id, type, adminUserId, reqMeta = {}) {
  const existing = await getAdminById(id, type);
  if (!existing) {
    const err = new Error(`${type === "blog" ? "Blog" : "News"} not found`);
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(`DELETE FROM articles WHERE id = :id AND type = :type`, { id, type });

  await writeAuditLog({
    userId: adminUserId,
    action: "ARTICLE_DELETED",
    entityType: type,
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { heading: existing.heading },
  });

  return { id, deleted: true };
}

async function getLatestInsights(limit = 3) {
  const [blogs] = await pool.query(
    `SELECT id, type, heading, description, image, created_at, updated_at
     FROM articles WHERE type = 'blog' AND status = 'published'
     ORDER BY created_at DESC LIMIT ${Math.min(limit, 10)}`
  );
  const [news] = await pool.query(
    `SELECT id, type, heading, description, image, created_at, updated_at
     FROM articles WHERE type = 'news' AND status = 'published'
     ORDER BY created_at DESC LIMIT ${Math.min(limit, 10)}`
  );

  return {
    blogs: blogs.map((r) => mapArticle(r)),
    news: news.map((r) => mapArticle(r)),
  };
}

module.exports = {
  ARTICLE_TYPES,
  formatImageUrl,
  listPublished,
  getPublishedById,
  listAdmin,
  getAdminById,
  createArticle,
  updateArticle,
  deleteArticle,
  getLatestInsights,
};
