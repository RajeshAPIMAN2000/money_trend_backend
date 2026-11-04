const path = require("path");
const fs = require("fs");

function resolveUploadsDir() {
  const configured = process.env.UPLOAD_DIR || "uploads";
  const uploadsDir = path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return uploadsDir;
}

module.exports = { resolveUploadsDir };
