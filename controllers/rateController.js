const {
  getTicker,
  listRates,
  getRateById,
  createRate,
  updateRate,
  updateRateStatus,
  deleteRate,
  syncRatesFromProvider,
} = require("../services/fdRdRateService");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || null;
}

function parseTenureQuery(req) {
  const tenureRaw = req.query.tenure;
  if (!tenureRaw) return { tenure: null, tenureUnit: null };
  const str = String(tenureRaw);
  const match = str.match(/^(\d+)\s*(days|months|years)$/i);
  if (match) {
    return { tenure: Number(match[1]), tenureUnit: match[2].toLowerCase() };
  }
  return { tenure: Number(str), tenureUnit: req.query.tenureUnit || req.query.tenure_unit || "years" };
}

/** GET /rates/ticker — highest FD/RD rates for frontend ticker (public) */
async function getRatesTicker(req, res) {
  try {
    const { tenure, tenureUnit } = parseTenureQuery(req);
    const category = req.query.category || null;
    const type = req.query.type || null;
    const limit = req.query.limit;

    const data = await getTicker({ limit, type, category, tenure, tenureUnit });

    return res.json({
      success: true,
      message: "Highest FD and RD interest rates for ticker",
      data,
    });
  } catch (error) {
    console.error("[RATES] ticker error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch rate ticker",
    });
  }
}

/** GET /rates — list rates (public, no sensitive admin fields stripped via mapper) */
async function listPublicRates(req, res) {
  try {
    const data = await listRates({
      productType: req.query.productType || req.query.type,
      status: req.query.status || "active",
      bankName: req.query.bank || req.query.bankName,
      category: req.query.category,
      sort: req.query.sort || "desc",
    });

    return res.json({
      success: true,
      message: "FD/RD interest rates",
      data,
    });
  } catch (error) {
    console.error("[RATES] list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to list rates",
    });
  }
}

/** GET /rates/:id */
async function getPublicRateById(req, res) {
  try {
    const id = Number(req.params.id);
    const data = await getRateById(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Rate not found" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[RATES] get by id error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch rate",
    });
  }
}

/** GET /admin/rates */
async function adminListRates(req, res) {
  try {
    const data = await listRates({
      productType: req.query.productType || req.query.type,
      status: req.query.status,
      bankName: req.query.bank || req.query.bankName,
      category: req.query.category,
      sort: req.query.sort || "desc",
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[RATES] admin list error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to list rates" });
  }
}

/** POST /admin/rates */
async function adminCreateRate(req, res) {
  try {
    const data = await createRate(req.body, req.user.id, { ip: getClientIp(req) });
    return res.status(201).json({
      success: true,
      message: "Rate created",
      data,
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message, error: error.details });
    }
    console.error("[RATES] admin create error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create rate" });
  }
}

/** PUT /admin/rates/:id */
async function adminUpdateRate(req, res) {
  try {
    const data = await updateRate(Number(req.params.id), req.body, req.user.id, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Rate updated", data });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[RATES] admin update error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update rate" });
  }
}

/** PATCH /admin/rates/:id/status */
async function adminPatchRateStatus(req, res) {
  try {
    const status = String(req.body.status || "").toLowerCase();
    const data = await updateRateStatus(Number(req.params.id), status, req.user.id, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Rate status updated", data });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[RATES] admin status error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update rate status" });
  }
}

/** DELETE /admin/rates/:id — soft deactivate */
async function adminDeleteRate(req, res) {
  try {
    const data = await deleteRate(Number(req.params.id), req.user.id, { ip: getClientIp(req) });
    return res.json({ success: true, message: "Rate deactivated", data });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("[RATES] admin delete error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to deactivate rate" });
  }
}

/** POST /admin/rates/sync — trigger manual sync from bank APIs */
async function adminSyncRates(req, res) {
  try {
    const result = await syncRatesFromProvider();
    return res.json({
      success: true,
      message: "Rates synchronized from bank provider",
      data: result,
    });
  } catch (error) {
    console.error("[RATES] admin sync error:", error.message);
    return res.status(502).json({
      success: false,
      message: "Rate synchronization failed",
    });
  }
}

module.exports = {
  getRatesTicker,
  listPublicRates,
  getPublicRateById,
  adminListRates,
  adminCreateRate,
  adminUpdateRate,
  adminPatchRateStatus,
  adminDeleteRate,
  adminSyncRates,
};
