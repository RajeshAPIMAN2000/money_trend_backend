const pool = require("../../config/db");
const { encryptPii, decryptPii } = require("../../utils/security");

async function upsertEnrollment({
  userId,
  equifaxEnrollmentId,
  customerReferenceNumber = null,
  status = "ACTIVE",
  featuresJson = null,
  metaJson = null,
}) {
  const [existing] = await pool.query(
    `SELECT id FROM equifax_enrollments WHERE user_id = :userId LIMIT 1`,
    { userId }
  );

  const crnEnc = customerReferenceNumber ? encryptPii(String(customerReferenceNumber)) : null;

  if (existing.length) {
    await pool.query(
      `UPDATE equifax_enrollments
       SET equifax_enrollment_id = :equifaxEnrollmentId,
           customer_reference_number = COALESCE(:crn, customer_reference_number),
           status = :status,
           features_json = COALESCE(:featuresJson, features_json),
           meta_json = COALESCE(:metaJson, meta_json),
           last_synced_at = NOW()
       WHERE user_id = :userId`,
      {
        userId,
        equifaxEnrollmentId,
        crn: crnEnc,
        status,
        featuresJson: featuresJson ? JSON.stringify(featuresJson) : null,
        metaJson: metaJson ? JSON.stringify(metaJson) : null,
      }
    );
    return existing[0].id;
  }

  const [result] = await pool.query(
    `INSERT INTO equifax_enrollments
      (user_id, equifax_enrollment_id, customer_reference_number, status, features_json, meta_json, last_synced_at)
     VALUES (:userId, :equifaxEnrollmentId, :crn, :status, :featuresJson, :metaJson, NOW())`,
    {
      userId,
      equifaxEnrollmentId,
      crn: crnEnc,
      status,
      featuresJson: featuresJson ? JSON.stringify(featuresJson) : null,
      metaJson: metaJson ? JSON.stringify(metaJson) : null,
    }
  );
  return result.insertId;
}

async function getEnrollmentByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, equifax_enrollment_id, customer_reference_number, status,
            features_json, last_synced_at, created_at, updated_at
     FROM equifax_enrollments WHERE user_id = :userId LIMIT 1`,
    { userId }
  );
  const row = rows[0];
  if (!row) return null;
  let features = null;
  try {
    features = row.features_json
      ? typeof row.features_json === "string"
        ? JSON.parse(row.features_json)
        : row.features_json
      : null;
  } catch (_e) {
    features = null;
  }
  return {
    ...row,
    customer_reference_number: row.customer_reference_number
      ? decryptPii(row.customer_reference_number)
      : null,
    features,
  };
}

async function saveScoreSnapshot({
  userId,
  enrollmentId,
  scoreType,
  featureName,
  scoreValue,
  scoreDate,
  equifaxScoreId,
  rawSafeJson,
}) {
  await pool.query(
    `INSERT INTO equifax_credit_scores
      (user_id, equifax_enrollment_id, score_type, feature_name, score_value, score_date, equifax_score_id, payload_json)
     VALUES (:userId, :enrollmentId, :scoreType, :featureName, :scoreValue, :scoreDate, :equifaxScoreId, :payload)`,
    {
      userId,
      enrollmentId,
      scoreType: scoreType || null,
      featureName: featureName || null,
      scoreValue: scoreValue != null ? Number(scoreValue) : null,
      scoreDate: scoreDate || null,
      equifaxScoreId: equifaxScoreId || null,
      payload: rawSafeJson ? JSON.stringify(rawSafeJson) : null,
    }
  );
}

async function upsertMonitoringAlert({
  userId,
  enrollmentId,
  alertId,
  alertType,
  alertDate,
  payloadSafe,
}) {
  const dedupeKey = `${enrollmentId || ""}:${alertId}`;
  await pool.query(
    `INSERT INTO equifax_monitoring_alerts
      (user_id, equifax_enrollment_id, alert_id, alert_type, alert_date, dedupe_key, payload_json)
     VALUES (:userId, :enrollmentId, :alertId, :alertType, :alertDate, :dedupeKey, :payload)
     ON DUPLICATE KEY UPDATE
       alert_type = VALUES(alert_type),
       alert_date = VALUES(alert_date),
       payload_json = VALUES(payload_json),
       updated_at = CURRENT_TIMESTAMP`,
    {
      userId,
      enrollmentId: enrollmentId || null,
      alertId: String(alertId),
      alertType: alertType || null,
      alertDate: alertDate || null,
      dedupeKey,
      payload: payloadSafe ? JSON.stringify(payloadSafe) : null,
    }
  );
}

async function listMonitoringAlerts(userId) {
  const [rows] = await pool.query(
    `SELECT id, alert_id, alert_type, alert_date, created_at, updated_at
     FROM equifax_monitoring_alerts
     WHERE user_id = :userId
     ORDER BY alert_date DESC, id DESC`,
    { userId }
  );
  return rows;
}

async function getMonitoringAlert(userId, alertId) {
  const [rows] = await pool.query(
    `SELECT id, alert_id, alert_type, alert_date, payload_json, created_at
     FROM equifax_monitoring_alerts
     WHERE user_id = :userId AND alert_id = :alertId
     LIMIT 1`,
    { userId, alertId: String(alertId) }
  );
  return rows[0] || null;
}

module.exports = {
  upsertEnrollment,
  getEnrollmentByUserId,
  saveScoreSnapshot,
  upsertMonitoringAlert,
  listMonitoringAlerts,
  getMonitoringAlert,
};
