const pool = require("../config/db");
const { writeAuditLog } = require("../utils/audit");

const ACTIVE = "active";
const INACTIVE = "inactive";
const DEACTIVATED = "deactivated";

function normalizeAccountStatus(value) {
  const s = String(value || ACTIVE).trim().toLowerCase();
  if (s === INACTIVE || s === "disabled") return INACTIVE;
  if (s === DEACTIVATED || s === "deactive") return DEACTIVATED;
  return ACTIVE;
}

function canReceiveMail(accountStatus) {
  return normalizeAccountStatus(accountStatus) === ACTIVE;
}

function canLoginWithoutAdmin(accountStatus) {
  const s = normalizeAccountStatus(accountStatus);
  // User self-deactivated accounts may log in to reactivate.
  // Admin-inactivated accounts cannot log in until admin activates.
  return s === ACTIVE || s === DEACTIVATED;
}

async function getUserAccountStatus(userId) {
  const [rows] = await pool.query(
    `SELECT id, role, account_status, account_status_reason, account_status_changed_at
     FROM users WHERE id = :userId LIMIT 1`,
    { userId: Number(userId) }
  );
  return rows[0] || null;
}

async function setAccountStatus({
  userId,
  status,
  reason = null,
  actorUserId = null,
  ipAddress = null,
  userAgent = null,
  source = "system",
}) {
  const next = normalizeAccountStatus(status);
  const [result] = await pool.query(
    `UPDATE users
     SET account_status = :status,
         account_status_reason = :reason,
         account_status_changed_at = NOW(),
         updated_at = NOW()
     WHERE id = :userId AND role = 'user'`,
    {
      userId: Number(userId),
      status: next,
      reason: reason ? String(reason).slice(0, 255) : null,
    }
  );

  if (!Number(result.affectedRows)) {
    const err = new Error("User not found");
    err.status = 404;
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  // Kill sessions when leaving active (except reactivation path which sets active)
  if (next !== ACTIVE) {
    try {
      await pool.query(`DELETE FROM refresh_tokens WHERE user_id = :userId`, {
        userId: Number(userId),
      });
    } catch (_e) {
      // table may vary in older DBs
    }
  }

  await writeAuditLog({
    userId: actorUserId || userId,
    action:
      next === ACTIVE
        ? "ACCOUNT_ACTIVATED"
        : next === DEACTIVATED
          ? "ACCOUNT_DEACTIVATED"
          : "ACCOUNT_INACTIVATED",
    entityType: "user",
    entityId: Number(userId),
    ipAddress,
    userAgent,
    meta: { status: next, reason, source },
  });

  return { user_id: Number(userId), account_status: next, reason };
}

async function reactivateIfDeactivated(userId, meta = {}) {
  const row = await getUserAccountStatus(userId);
  if (!row) return { reactivated: false, account_status: ACTIVE };
  const status = normalizeAccountStatus(row.account_status);
  if (status === DEACTIVATED) {
    await setAccountStatus({
      userId,
      status: ACTIVE,
      reason: "Reactivated on login",
      actorUserId: userId,
      source: "user_login",
      ...meta,
    });
    return { reactivated: true, account_status: ACTIVE };
  }
  return { reactivated: false, account_status: status };
}

async function hardDeleteUser({
  userId,
  actorUserId = null,
  ipAddress = null,
  userAgent = null,
}) {
  const id = Number(userId);
  const [rows] = await pool.query(
    `SELECT id, email, full_name, role FROM users WHERE id = :id AND role = 'user' LIMIT 1`,
    { id }
  );
  if (!rows.length) {
    const err = new Error("User not found");
    err.status = 404;
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const user = rows[0];

  try {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = :id`, { id });
  } catch (_e) {
    /* ignore */
  }

  // Dependent rows use ON DELETE CASCADE where defined
  await pool.query(`DELETE FROM users WHERE id = :id AND role = 'user'`, { id });

  await writeAuditLog({
    userId: actorUserId,
    action: "ACCOUNT_DELETED",
    entityType: "user",
    entityId: id,
    ipAddress,
    userAgent,
    meta: { email: user.email, full_name: user.full_name },
  });

  return { deleted: true, user_id: id, email: user.email };
}

module.exports = {
  ACTIVE,
  INACTIVE,
  DEACTIVATED,
  normalizeAccountStatus,
  canReceiveMail,
  canLoginWithoutAdmin,
  getUserAccountStatus,
  setAccountStatus,
  reactivateIfDeactivated,
  hardDeleteUser,
};
