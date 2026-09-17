/**
 * Credit Monitoring APIs (delivery_token).
 * Sandbox alert types are fixtures — do not assume webhook delivery without Equifax docs.
 */

const { equifaxRequest } = require("./equifaxClient");
const {
  getEnrollmentByUserId,
  upsertMonitoringAlert,
  listMonitoringAlerts,
  getMonitoringAlert,
} = require("./enrollmentRepository");
const { writeAuditLog } = require("../../utils/audit");
const { isEquifaxMockMode } = require("./equifaxConfig");
const { mockMonitoringAlerts } = require("./equifaxMock");

async function requireEnrollmentId(userId) {
  const row = await getEnrollmentByUserId(userId);
  if (!row?.equifax_enrollment_id) {
    const err = new Error("No Equifax enrollment found. Call enrollment first.");
    err.code = "EQUIFAX_ENROLLMENT_REQUIRED";
    err.status = 400;
    throw err;
  }
  return row.equifax_enrollment_id;
}

function normalizeAlert(item) {
  if (!item || typeof item !== "object") return null;
  const alertId = item.alertId || item.id || item.alertID || null;
  if (!alertId) return null;
  return {
    alertId: String(alertId),
    alertType: item.alertType || item.type || item.category || null,
    alertDate: item.alertDate || item.date || item.createdDate || null,
    safe: {
      alertId: String(alertId),
      alertType: item.alertType || item.type || null,
      alertDate: item.alertDate || item.date || null,
      keys: Object.keys(item).slice(0, 30),
    },
  };
}

async function syncMonitoringAlerts(userId) {
  const enrollmentId = await requireEnrollmentId(userId);

  if (isEquifaxMockMode()) {
    const rawList = mockMonitoringAlerts(userId);
    let synced = 0;
    for (const item of rawList) {
      const n = normalizeAlert(item);
      if (!n) continue;
      await upsertMonitoringAlert({
        userId,
        enrollmentId,
        alertId: n.alertId,
        alertType: n.alertType,
        alertDate: n.alertDate,
        payloadSafe: n.safe,
      });
      synced += 1;
    }
    const alerts = await listMonitoringAlerts(userId);
    return { synced, alerts, correlationId: "mock", is_mock: true };
  }

  const result = await equifaxRequest({
    method: "GET",
    path: "/personal/consumer-data-suite/v1/creditMonitoring",
    tokenKind: "delivery",
    operation: "creditMonitoring.list",
  });

  const rawList = Array.isArray(result.data)
    ? result.data
    : result.data?.alerts || result.data?.items || [];

  let synced = 0;
  for (const item of rawList) {
    const n = normalizeAlert(item);
    if (!n) continue;
    await upsertMonitoringAlert({
      userId,
      enrollmentId,
      alertId: n.alertId,
      alertType: n.alertType,
      alertDate: n.alertDate,
      payloadSafe: n.safe,
    });
    synced += 1;
  }

  await writeAuditLog({
    userId,
    action: "EQUIFAX_MONITORING_SYNC",
    entityType: "equifax_monitoring",
    entityId: enrollmentId,
    meta: { synced },
  });

  const alerts = await listMonitoringAlerts(userId);
  return { synced, alerts, correlationId: result.correlationId };
}

async function getMonitoringAlertRemote(userId, alertId) {
  await requireEnrollmentId(userId);
  const result = await equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/creditMonitoring/${encodeURIComponent(alertId)}`,
    tokenKind: "delivery",
    operation: "creditMonitoring.byId",
  });

  const n = normalizeAlert(result.data) || {
    alertId: String(alertId),
    alertType: null,
    alertDate: null,
    safe: { alertId: String(alertId), keys: [] },
  };

  const enrollmentId = await requireEnrollmentId(userId);
  await upsertMonitoringAlert({
    userId,
    enrollmentId,
    alertId: n.alertId,
    alertType: n.alertType,
    alertDate: n.alertDate,
    payloadSafe: n.safe,
  });

  return {
    alert: await getMonitoringAlert(userId, alertId),
    data: result.data,
    correlationId: result.correlationId,
  };
}

async function listStoredAlerts(userId) {
  return listMonitoringAlerts(userId);
}

module.exports = {
  syncMonitoringAlerts,
  getMonitoringAlertRemote,
  listStoredAlerts,
  normalizeAlert,
};
