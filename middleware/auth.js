const { verifyAccessToken } = require("../utils/jwt");

function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = req.cookies?.accessToken || null;
    const token = bearer || cookieToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || "user",
    };
    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

/** Attach req.user when a valid token is present; otherwise continue as guest. */
function optionalAuthenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = req.cookies?.accessToken || null;
    const token = bearer || cookieToken;
    if (!token) {
      req.user = null;
      return next();
    }
    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || "user",
    };
  } catch (_error) {
    req.user = null;
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  return next();
}

module.exports = { authenticate, optionalAuthenticate, requireAdmin };
