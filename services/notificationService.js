const pool = require("../config/db");
const { parsePermissionsJson } = require("./staffPermissionService");

const AUDIENCES = ["user", "admin", "content_manager", "customer_support"];

/**
 * Create one in-app notification.
 * Fire-and-forget from callers via safeNotify(() => createNotification(...)).
 */
async function createNotification({
  userId,
  audience = "user",
  eventType,
  title,
  body = null,
  referenceType = null,
  referenceId = null,
  meta = null,
}) {
  const uid = Number(userId);
  if (!uid || !eventType || !title) return null;

  const safeAudience = AUDIENCES.includes(audience) ? audience : "user";

  const [result] = await pool.query(
    `INSERT INTO notifications
      (user_id, audience, event_type, title, body, reference_type, reference_id, meta_json)
     VALUES
      (:userId, :audience, :eventType, :title, :body, :referenceType, :referenceId, :meta)`,
    {
      userId: uid,
      audience: safeAudience,
      eventType: String(eventType).slice(0, 64),
      title: String(title).slice(0, 200),
      body: body != null ? String(body).slice(0, 1000) : null,
      referenceType: referenceType != null ? String(referenceType).slice(0, 40) : null,
      referenceId: referenceId != null ? Number(referenceId) : null,
      meta: meta != null ? JSON.stringify(meta) : null,
    }
  );

  return { id: result.insertId, user_id: uid, event_type: eventType };
}

/** Bulk insert for many recipients (article publish, investment mail, etc.). */
async function createNotificationsForUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => id > 0))];
  if (!ids.length) return { created: 0 };

  const {
    audience = "user",
    eventType,
    title,
    body = null,
    referenceType = null,
    referenceId = null,
    meta = null,
  } = payload || {};

  if (!eventType || !title) return { created: 0 };

  const safeAudience = AUDIENCES.includes(audience) ? audience : "user";
  const metaJson = meta != null ? JSON.stringify(meta) : null;
  const chunkSize = 200;
  let created = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = [];
    for (const uid of chunk) {
      values.push(
        uid,
        safeAudience,
        String(eventType).slice(0, 64),
        String(title).slice(0, 200),
        body != null ? String(body).slice(0, 1000) : null,
        referenceType != null ? String(referenceType).slice(0, 40) : null,
        referenceId != null ? Number(referenceId) : null,
        metaJson
      );
    }
    const [result] = await pool.query(
      `INSERT INTO notifications
        (user_id, audience, event_type, title, body, reference_type, reference_id, meta_json)
       VALUES ${placeholders}`,
      values
    );
    created += result.affectedRows || chunk.length;
  }

  return { created };
}

function safeNotify(fn) {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error("[NOTIF]", err.message || err));
  });
}

async function listAdminUserIds() {
  const [rows] = await pool.query(
    `SELECT id FROM users
     WHERE role = 'admin'
       AND (staff_active IS NULL OR staff_active = 1)`
  );
  return rows.map((r) => r.id);
}

async function listStaffIdsByPermission(permissionKey) {
  const [rows] = await pool.query(
    `SELECT id, staff_permissions FROM users
     WHERE role = 'sub_admin'
       AND (staff_active IS NULL OR staff_active = 1)`
  );
  return rows
    .filter((r) => parsePermissionsJson(r.staff_permissions).includes(permissionKey))
    .map((r) => r.id);
}

async function listRegisteredUserIds() {
  const [rows] = await pool.query(
    `SELECT id FROM users
     WHERE role = 'user'
       AND email IS NOT NULL AND email <> ''`
  );
  return rows.map((r) => r.id);
}

async function notifyUser(userId, payload) {
  return createNotification({
    userId,
    audience: "user",
    ...payload,
  });
}

async function notifyAdmins(payload) {
  const ids = await listAdminUserIds();
  return createNotificationsForUsers(ids, { audience: "admin", ...payload });
}

async function notifyContentManagers(payload) {
  const blog = await listStaffIdsByPermission("blog");
  const news = await listStaffIdsByPermission("news");
  const ids = [...new Set([...blog, ...news])];
  return createNotificationsForUsers(ids, { audience: "content_manager", ...payload });
}

async function notifyCustomerSupport(payload, { onlyUserIds = null } = {}) {
  const ids = onlyUserIds
    ? onlyUserIds
    : await listStaffIdsByPermission("support");
  return createNotificationsForUsers(ids, { audience: "customer_support", ...payload });
}

async function notifyAllUsers(payload) {
  const ids = await listRegisteredUserIds();
  return createNotificationsForUsers(ids, { audience: "user", ...payload });
}

function formatNotification(row) {
  if (!row) return null;
  let meta = null;
  if (row.meta_json) {
    try {
      meta = typeof row.meta_json === "string" ? JSON.parse(row.meta_json) : row.meta_json;
    } catch (_e) {
      meta = null;
    }
  }
  return {
    id: row.id,
    audience: row.audience,
    event_type: row.event_type,
    title: row.title,
    body: row.body,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    meta,
    is_read: Boolean(row.is_read),
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

async function listNotifications(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const params = { userId: Number(userId) };
  let where = `user_id = :userId`;
  if (unreadOnly) where += ` AND is_read = 0`;

  const [rows] = await pool.query(
    `SELECT * FROM notifications
     WHERE ${where}
     ORDER BY id DESC
     LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM notifications WHERE ${where}`,
    params
  );
  const [unreadRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM notifications WHERE user_id = :userId AND is_read = 0`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    unread_count: Number(unreadRows[0]?.total || 0),
    notifications: rows.map(formatNotification),
  };
}

async function getUnreadCount(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM notifications WHERE user_id = :userId AND is_read = 0`,
    { userId: Number(userId) }
  );
  return Number(rows[0]?.total || 0);
}

async function markRead(userId, notificationId) {
  const [result] = await pool.query(
    `UPDATE notifications
     SET is_read = 1, read_at = COALESCE(read_at, NOW())
     WHERE id = :id AND user_id = :userId`,
    { id: Number(notificationId), userId: Number(userId) }
  );
  if (!result.affectedRows) {
    const err = new Error("Notification not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return { id: Number(notificationId), is_read: true };
}

async function markAllRead(userId) {
  const [result] = await pool.query(
    `UPDATE notifications
     SET is_read = 1, read_at = COALESCE(read_at, NOW())
     WHERE user_id = :userId AND is_read = 0`,
    { userId: Number(userId) }
  );
  return { marked: result.affectedRows || 0 };
}

module.exports = {
  AUDIENCES,
  createNotification,
  createNotificationsForUsers,
  safeNotify,
  notifyUser,
  notifyAdmins,
  notifyContentManagers,
  notifyCustomerSupport,
  notifyAllUsers,
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  listAdminUserIds,
  listStaffIdsByPermission,
  listRegisteredUserIds,
};
