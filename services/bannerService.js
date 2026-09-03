const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");
const { writeAuditLog } = require("../utils/audit");
const { formatImageUrl } = require("./articleService");

function mapBanner(row, { includeMeta = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    title: row.title,
    description: row.description,
    image: formatImageUrl(row.image),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeMeta) {
    item.created_by = row.created_by;
  }
  return item;
}

function validateBannerInput(body, { requireImage = false, isUpdate = false } = {}) {
  const errors = [];
  const title = sanitizeText(body.title || body.heading, 255);
  const description = sanitizeText(body.description || body.content, 5000);
  const image = body.image || body.image_url || body.imageUrl || null;

  if (!isUpdate && !title) errors.push("title is required");
  if (!isUpdate && !description) errors.push("description is required");
  if (requireImage && !image) errors.push("image is required");

  return {
    errors,
    data: { title, description, image },
  };
}

async function listPublic({ limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT id, title, description, image, created_at, updated_at
     FROM banners
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`
  );

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM banners`);

  return {
    items: rows.map((r) => mapBanner(r)),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getById(id) {
  const [rows] = await pool.query(
    `SELECT id, title, description, image, created_at, updated_at
     FROM banners WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows.length ? mapBanner(rows[0]) : null;
}

async function listAdmin({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows] = await pool.query(
    `SELECT id, title, description, image, created_by, created_at, updated_at
     FROM banners
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`
  );

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM banners`);

  return {
    items: rows.map((r) => mapBanner(r, { includeMeta: true })),
    total: Number(countRows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getAdminById(id) {
  const [rows] = await pool.query(
    `SELECT id, title, description, image, created_by, created_at, updated_at
     FROM banners WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows.length ? mapBanner(rows[0], { includeMeta: true }) : null;
}

async function createBanner(body, adminUserId, reqMeta = {}) {
  const validation = validateBannerInput(body, { requireImage: true });
  if (validation.errors.length) {
    const err = new Error(validation.errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = validation.errors;
    throw err;
  }

  const [result] = await pool.query(
    `INSERT INTO banners (title, description, image, created_by)
     VALUES (:title, :description, :image, :createdBy)`,
    {
      title: validation.data.title,
      description: validation.data.description,
      image: validation.data.image,
      createdBy: adminUserId,
    }
  );

  await writeAuditLog({
    userId: adminUserId,
    action: "BANNER_CREATED",
    entityType: "banner",
    entityId: result.insertId,
    ipAddress: reqMeta.ip,
    meta: { title: validation.data.title },
  });

  return getAdminById(result.insertId);
}

async function updateBanner(id, body, adminUserId, reqMeta = {}) {
  const existing = await getAdminById(id);
  if (!existing) {
    const err = new Error("Banner not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const { errors, data } = validateBannerInput(
    {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      image: body.image ?? body.image_url ?? existing.image?.replace("/uploads/", ""),
    },
    { isUpdate: true }
  );

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "VALIDATION_ERROR";
    err.details = errors;
    throw err;
  }

  await pool.query(
    `UPDATE banners SET
      title = :title,
      description = :description,
      image = :image,
      updated_at = NOW()
     WHERE id = :id`,
    {
      id,
      title: data.title || existing.title,
      description: data.description || existing.description,
      image: data.image || existing.image?.replace("/uploads/", "") || null,
    }
  );

  await writeAuditLog({
    userId: adminUserId,
    action: "BANNER_UPDATED",
    entityType: "banner",
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { title: data.title },
  });

  return getAdminById(id);
}

async function deleteBanner(id, adminUserId, reqMeta = {}) {
  const existing = await getAdminById(id);
  if (!existing) {
    const err = new Error("Banner not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  await pool.query(`DELETE FROM banners WHERE id = :id`, { id });

  await writeAuditLog({
    userId: adminUserId,
    action: "BANNER_DELETED",
    entityType: "banner",
    entityId: id,
    ipAddress: reqMeta.ip,
    meta: { title: existing.title },
  });

  return { id, deleted: true };
}

module.exports = {
  listPublic,
  getById,
  listAdmin,
  getAdminById,
  createBanner,
  updateBanner,
  deleteBanner,
};
