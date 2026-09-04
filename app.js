const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs");
require("dotenv").config();

const { resolveUploadsDir } = require("./config/uploadsPath");
const { ensureCoreTables } = require("./config/db_init");
const { startRateSyncScheduler } = require("./services/fdRdRateService");
const { swaggerSpec } = require("./config/swagger");
const swaggerUi = require("swagger-ui-express");

const authRoutes = require("./routes/auth");
const kycRoutes = require("./routes/kyc");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");
const marketRoutes = require("./routes/market");
const fdRoutes = require("./routes/fd");
const walletRoutes = require("./routes/wallet");
const creditCheckRoutes = require("./routes/creditCheck");
const ratesRoutes = require("./routes/rates");
const homeRoutes = require("./routes/home");
const articlesRoutes = require("./routes/articles");
const bannersRoutes = require("./routes/banners");
const supportRoutes = require("./routes/support");

const app = express();

function parseFrontendOrigins() {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim() || String(raw).trim() === "*") {
    return true;
  }
  return String(raw)
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function healthPayload() {
  return { success: true, message: "Money Trend backend is running" };
}

function mountApiRoutes(basePath = "") {
  const base = String(basePath || "").replace(/\/$/, "");
  const route = (suffix) => (base ? `${base}${suffix}` : suffix);

  app.use(route("/auth"), authRoutes);
  app.use(route("/kyc"), kycRoutes);
  app.use(route("/profile"), profileRoutes);
  app.use(route("/admin"), adminRoutes);
  app.use(route("/market"), marketRoutes);
  app.use(route("/fd"), fdRoutes);
  app.use(route("/wallet"), walletRoutes);
  app.use(route("/credit-check"), creditCheckRoutes);
  app.use(route("/rates"), ratesRoutes);
  app.use(route("/home"), homeRoutes);
  app.use(route("/articles"), articlesRoutes);
  app.use(route("/banners"), bannersRoutes);
  app.use(route("/support"), supportRoutes);
  app.get(route("/health"), (_req, res) => {
    res.json(healthPayload());
  });
}

if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: parseFrontendOrigins(),
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Fintech security headers (SEBI / production-safe baseline)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// Swagger API docs
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "Money Trend API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "none",
      filter: true,
    },
  })
);
app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

const uploadsDir = resolveUploadsDir();
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
      try {
        const buffer = Buffer.alloc(12);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buffer, 0, 12, 0);
        fs.closeSync(fd);

        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
          res.setHeader("Content-Type", "image/png");
        } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
          res.setHeader("Content-Type", "image/jpeg");
        } else if (buffer.toString("ascii", 0, 4) === "RIFF") {
          res.setHeader("Content-Type", "image/webp");
        } else if (
          buffer.toString("ascii", 0, 6) === "GIF89a" ||
          buffer.toString("ascii", 0, 6) === "GIF87a"
        ) {
          res.setHeader("Content-Type", "image/gif");
        }
      } catch (_e) {
        // leave default content-type if sniffing fails
      }
    },
  })
);

app.get(["/api", "/api/"], (_req, res) => {
  res.json({
    success: true,
    message: "Money Trend API",
    health: "/api/health",
    routes: [
      "/api/auth",
      "/api/kyc",
      "/api/profile",
      "/api/admin",
      "/api/market",
      "/api/fd",
      "/api/wallet",
      "/api/support",
    ],
    docs: "/api-docs",
  });
});

app.get("/health", (_req, res) => {
  res.json(healthPayload());
});

// Standard paths used by Vite proxy and direct Node access.
mountApiRoutes("/api");
// cPanel/LiteSpeed often forwards /api/* with the prefix stripped.
mountApiRoutes("");

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
    hint: "Redeploy the latest Money Trend backend and ensure /api is proxied to this Node app.",
  });
});

app.use((error, req, res, _next) => {
  console.error("[ERROR]", req.method, req.originalUrl, error);

  if (error && error.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: error.message === "Unexpected field"
        ? "Unexpected form-data field. Use pan_image and aadhaar_image for KYC uploads."
        : error.message,
      error: error.message,
      field: error.field || null,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    error: error.message,
  });
});

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";

async function startServer() {
  try {
    await ensureCoreTables();
    startRateSyncScheduler();
    app.listen(port, host, () => {
      const displayHost = host === "0.0.0.0" ? "localhost" : host;
      // eslint-disable-next-line no-console
      console.log(`Money Trend backend running on http://${displayHost}:${port}`);
      // eslint-disable-next-line no-console
      console.log(`Swagger docs: http://${displayHost}:${port}/api-docs`);
      // eslint-disable-next-line no-console
      console.log(`Serving uploads from ${uploadsDir}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
