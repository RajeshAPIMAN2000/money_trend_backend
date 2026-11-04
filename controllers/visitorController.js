const { getVisitorStats, recordVisitorHit } = require("../services/visitorService");

async function getVisitors(_req, res) {
  try {
    const data = await getVisitorStats();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[VISITORS] stats error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch visitor stats" });
  }
}

async function recordVisitor(req, res) {
  try {
    const data = await recordVisitorHit(req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[VISITORS] record error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to record visitor" });
  }
}

module.exports = { getVisitors, recordVisitor };