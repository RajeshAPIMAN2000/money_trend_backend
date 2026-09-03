const {
  listPublic,
  getById,
  listAdmin,
  getAdminById,
  createBanner,
  updateBanner,
  deleteBanner,
} = require("../services/bannerService");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || null;
}

function pickImageFile(req) {
  if (req.file?.filename) return req.file.filename;
  if (Array.isArray(req.files) && req.files.length) {
    const img = req.files.find((f) => /image|photo|banner/i.test(f.fieldname));
    return img?.filename || req.files[0]?.filename || null;
  }
  return req.body?.image || req.body?.image_url || req.body?.imageUrl || null;
}

function handleError(res, error, fallback) {
  if (error.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.code === "VALIDATION_ERROR") {
    return res.status(400).json({ success: false, message: error.message, error: error.details });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ success: false, message: fallback });
}

// ——— Public (no login) ———

async function listBanners(req, res) {
  try {
    const data = await listPublic({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, message: "Banners fetched", data });
  } catch (error) {
    return handleError(res, error, "Failed to fetch banners");
  }
}

async function getBannerById(req, res) {
  try {
    const item = await getById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Banner not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch banner");
  }
}

// ——— Admin ———

async function adminListBanners(req, res) {
  try {
    const data = await listAdmin({
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, message: "Banners fetched", data });
  } catch (error) {
    return handleError(res, error, "Failed to list banners");
  }
}

async function adminGetBanner(req, res) {
  try {
    const item = await getAdminById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Banner not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch banner");
  }
}

async function adminCreateBanner(req, res) {
  try {
    const body = { ...req.body, image: pickImageFile(req) };
    const data = await createBanner(body, req.user.id, { ip: getClientIp(req) });
    return res.status(201).json({ success: true, message: "Banner created", data });
  } catch (error) {
    return handleError(res, error, "Failed to create banner");
  }
}

async function adminUpdateBanner(req, res) {
  try {
    const body = { ...req.body };
    const uploaded = pickImageFile(req);
    if (uploaded) body.image = uploaded;
    const data = await updateBanner(Number(req.params.id), body, req.user.id, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Banner updated", data });
  } catch (error) {
    return handleError(res, error, "Failed to update banner");
  }
}

async function adminDeleteBanner(req, res) {
  try {
    const data = await deleteBanner(Number(req.params.id), req.user.id, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Banner deleted", data });
  } catch (error) {
    return handleError(res, error, "Failed to delete banner");
  }
}

module.exports = {
  listBanners,
  getBannerById,
  adminListBanners,
  adminGetBanner,
  adminCreateBanner,
  adminUpdateBanner,
  adminDeleteBanner,
};
