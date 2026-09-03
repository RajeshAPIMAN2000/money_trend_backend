const pool = require("../config/db");

async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId = null,
  ipAddress = null,
  userAgent = null,
  meta = null,
}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, ip_address, user_agent, meta_json)
       VALUES
        (:userId, :action, :entityType, :entityId, :ipAddress, :userAgent, :metaJson)`,
      {
        userId: userId || null,
        action,
        entityType,
        entityId,
        ipAddress,
        userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
        metaJson: meta ? JSON.stringify(meta) : null,
      }
    );
  } catch (error) {
    console.error("[AUDIT] failed to write log:", error.message);
  }
}

module.exports = { writeAuditLog };
