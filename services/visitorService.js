const pool = require("../config/db");

function parseVisitInput(body = {}) {
  const deviceId = String(body.device_id || body.deviceId || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(deviceId)) {
    const err = new Error("A valid device_id is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const requestedPath = String(body.path || "/").trim();
  const path = requestedPath.startsWith("/") ? requestedPath.slice(0, 255) : "/";
  return { deviceId, path };
}

async function getVisitorStats(deviceId = null) {
  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS count, COUNT(DISTINCT device_id) AS unique_devices
     FROM visitor_hits`
  );

  return {
    count: Number(stats?.count || 0),
    unique_devices: Number(stats?.unique_devices || 0),
    device_id: deviceId,
  };
}

async function recordVisitorHit(body) {
  const { deviceId, path } = parseVisitInput(body);
  await pool.query(
    `INSERT INTO visitor_hits (device_id, path) VALUES (:deviceId, :path)`,
    { deviceId, path }
  );
  return getVisitorStats(deviceId);
}

module.exports = { getVisitorStats, parseVisitInput, recordVisitorHit };