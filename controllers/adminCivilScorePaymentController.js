const { listCivilScorePayments } = require("../services/adminCivilScorePaymentService");

async function listAdminCivilScorePayments(req, res) {
  try {
    const data = await listCivilScorePayments(req.query);
    return res.json({
      success: true,
      message: "Civil checker payments fetched",
      data,
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[ADMIN] civil score payments list error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch civil checker payments",
    });
  }
}

module.exports = { listAdminCivilScorePayments };
