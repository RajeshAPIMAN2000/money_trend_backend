const express = require("express");
const path = require("path");
const multer = require("multer");
const { authenticate } = require("../middleware/auth");
const { resolveUploadsDir } = require("../config/uploadsPath");
const {
  getHelpMeta,
  submitTicket,
  listMyTickets,
  getMyTicket,
} = require("../controllers/supportController");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, resolveUploadsDir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40);
    cb(null, `support_${Date.now()}_${safeBase || "file"}${ext}`);
  },
});

function supportFileFilter(_req, file, cb) {
  const allowed = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only image or PDF attachments are allowed"));
}

const supportUpload = multer({
  storage,
  fileFilter: supportFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Public help meta (FAQs, subjects, stats) */
router.get("/help", getHelpMeta);
router.get("/faqs", getHelpMeta);

/** Authenticated user support tickets */
router.post("/", authenticate, supportUpload.single("attachment"), submitTicket);
router.get("/", authenticate, listMyTickets);
router.get("/:id", authenticate, getMyTicket);

module.exports = router;
