const {
  listPublished,
  getPublishedById,
  listAdmin,
  listDistinctCategories,
  getAdminById,
  createArticle,
  updateArticle,
  deleteArticle,
  approveArticle,
  rejectArticle,
  ARTICLE_CATEGORIES,
} = require("../services/articleService");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.ip || null;
}

function pickImageFile(req) {
  if (req.file?.filename) return req.file.filename;
  if (Array.isArray(req.files) && req.files.length) {
    const img = req.files.find((f) => /image|photo|cover/i.test(f.fieldname));
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
  if (error.code === "FORBIDDEN") {
    return res.status(403).json({ success: false, message: error.message, code: "FORBIDDEN" });
  }
  if (error.code === "STALE_ADMIN_SESSION") {
    return res.status(401).json({
      success: false,
      message: error.message,
      code: "STALE_ADMIN_SESSION",
    });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

// ——— Public (no login) — only published; type locked by route ———

async function listBlogs(req, res) {
  try {
    const data = await listPublished("blog", {
      limit: req.query.limit,
      offset: req.query.offset,
      category: req.query.category,
    });
    return res.json({ success: true, message: "Blogs fetched", data });
  } catch (error) {
    return handleError(res, error, "Failed to fetch blogs");
  }
}

async function getBlogById(req, res) {
  try {
    const item = await getPublishedById(Number(req.params.id), "blog");
    if (!item) return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch blog");
  }
}

async function listNews(req, res) {
  try {
    const data = await listPublished("news", {
      limit: req.query.limit,
      offset: req.query.offset,
      category: req.query.category,
    });
    return res.json({ success: true, message: "News fetched", data });
  } catch (error) {
    return handleError(res, error, "Failed to fetch news");
  }
}

async function getNewsById(req, res) {
  try {
    const item = await getPublishedById(Number(req.params.id), "news");
    if (!item) return res.status(404).json({ success: false, message: "News not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch news");
  }
}

async function listArticleCategories(req, res) {
  try {
    const type = req.query.type || null;
    const categories = await listDistinctCategories(type);
    return res.json({
      success: true,
      data: { categories, defaults: ARTICLE_CATEGORIES },
    });
  } catch (error) {
    return handleError(res, error, "Failed to list categories");
  }
}

// ——— Staff (Admin / Sub Admin with blog|news permission) ———

async function adminListBlogs(req, res) {
  try {
    const data = await listAdmin("blog", {
      status: req.query.status,
      category: req.query.category,
      limit: req.query.limit,
      offset: req.query.offset,
      actor: req.user,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list blogs");
  }
}

async function adminGetBlog(req, res) {
  try {
    const item = await getAdminById(Number(req.params.id), "blog");
    if (!item) return res.status(404).json({ success: false, message: "Blog not found" });
    if (req.user.role === "sub_admin" && Number(item.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: "You can only view your own posts" });
    }
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch blog");
  }
}

async function adminCreateBlog(req, res) {
  try {
    const body = { ...req.body, image: pickImageFile(req) };
    const data = await createArticle("blog", body, req.user, { ip: getClientIp(req) });
    const pending = data?.status === "pending";
    return res.status(201).json({
      success: true,
      message: pending
        ? "Blog submitted for Admin approval"
        : "Blog created",
      data,
    });
  } catch (error) {
    return handleError(res, error, "Failed to create blog");
  }
}

async function adminUpdateBlog(req, res) {
  try {
    const body = { ...req.body };
    const uploaded = pickImageFile(req);
    if (uploaded) body.image = uploaded;
    const data = await updateArticle(Number(req.params.id), "blog", body, req.user, {
      ip: getClientIp(req),
    });
    return res.json({
      success: true,
      message:
        data?.status === "pending"
          ? "Blog updated and submitted for Admin approval"
          : "Blog updated",
      data,
    });
  } catch (error) {
    return handleError(res, error, "Failed to update blog");
  }
}

async function adminDeleteBlog(req, res) {
  try {
    const data = await deleteArticle(Number(req.params.id), "blog", req.user, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Blog deleted", data });
  } catch (error) {
    return handleError(res, error, "Failed to delete blog");
  }
}

async function adminApproveBlog(req, res) {
  try {
    const data = await approveArticle(Number(req.params.id), "blog", req.user, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Blog approved and published", data });
  } catch (error) {
    return handleError(res, error, "Failed to approve blog");
  }
}

async function adminRejectBlog(req, res) {
  try {
    const reason = req.body?.reason || req.body?.rejection_reason || req.body?.region;
    const data = await rejectArticle(Number(req.params.id), "blog", req.user, reason, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "Blog rejected", data });
  } catch (error) {
    return handleError(res, error, "Failed to reject blog");
  }
}

async function adminListNews(req, res) {
  try {
    const data = await listAdmin("news", {
      status: req.query.status,
      category: req.query.category,
      limit: req.query.limit,
      offset: req.query.offset,
      actor: req.user,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list news");
  }
}

async function adminGetNews(req, res) {
  try {
    const item = await getAdminById(Number(req.params.id), "news");
    if (!item) return res.status(404).json({ success: false, message: "News not found" });
    if (req.user.role === "sub_admin" && Number(item.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: "You can only view your own posts" });
    }
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleError(res, error, "Failed to fetch news");
  }
}

async function adminCreateNews(req, res) {
  try {
    const body = { ...req.body, image: pickImageFile(req) };
    const data = await createArticle("news", body, req.user, { ip: getClientIp(req) });
    const pending = data?.status === "pending";
    return res.status(201).json({
      success: true,
      message: pending
        ? "News submitted for Admin approval"
        : "News created",
      data,
    });
  } catch (error) {
    return handleError(res, error, "Failed to create news");
  }
}

async function adminUpdateNews(req, res) {
  try {
    const body = { ...req.body };
    const uploaded = pickImageFile(req);
    if (uploaded) body.image = uploaded;
    const data = await updateArticle(Number(req.params.id), "news", body, req.user, {
      ip: getClientIp(req),
    });
    return res.json({
      success: true,
      message:
        data?.status === "pending"
          ? "News updated and submitted for Admin approval"
          : "News updated",
      data,
    });
  } catch (error) {
    return handleError(res, error, "Failed to update news");
  }
}

async function adminDeleteNews(req, res) {
  try {
    const data = await deleteArticle(Number(req.params.id), "news", req.user, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "News deleted", data });
  } catch (error) {
    return handleError(res, error, "Failed to delete news");
  }
}

async function adminApproveNews(req, res) {
  try {
    const data = await approveArticle(Number(req.params.id), "news", req.user, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "News approved and published", data });
  } catch (error) {
    return handleError(res, error, "Failed to approve news");
  }
}

async function adminRejectNews(req, res) {
  try {
    const reason = req.body?.reason || req.body?.rejection_reason || req.body?.region;
    const data = await rejectArticle(Number(req.params.id), "news", req.user, reason, {
      ip: getClientIp(req),
    });
    return res.json({ success: true, message: "News rejected", data });
  } catch (error) {
    return handleError(res, error, "Failed to reject news");
  }
}

module.exports = {
  listBlogs,
  getBlogById,
  listNews,
  getNewsById,
  listArticleCategories,
  adminListBlogs,
  adminGetBlog,
  adminCreateBlog,
  adminUpdateBlog,
  adminDeleteBlog,
  adminApproveBlog,
  adminRejectBlog,
  adminListNews,
  adminGetNews,
  adminCreateNews,
  adminUpdateNews,
  adminDeleteNews,
  adminApproveNews,
  adminRejectNews,
};
