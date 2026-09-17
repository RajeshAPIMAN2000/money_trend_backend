const { verifyAccessToken } = require("../utils/jwt");
const {
  isStaff,
  isFullAdmin,
  hasPermission,
  parsePermissionsJson,
} = require("../services/staffPermissionService");

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
      permissions: Array.isArray(decoded.permissions)
        ? decoded.permissions
        : parsePermissionsJson(decoded.permissions),
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
      permissions: Array.isArray(decoded.permissions)
        ? decoded.permissions
        : parsePermissionsJson(decoded.permissions),
    };
  } catch (_error) {
    req.user = null;
  }
  return next();
}

/** Full admin only */
function requireAdmin(req, res, next) {
  if (!isFullAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  return next();
}

/** Admin or sub-admin */
function requireStaff(req, res, next) {
  if (!isStaff(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Staff access required",
    });
  }
  return next();
}

/** Admin always allowed; sub-admin needs the given permission key (seo|blog|news) */
function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!isStaff(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Staff access required",
      });
    }
    if (!hasPermission(req.user, permissionKey)) {
      return res.status(403).json({
        success: false,
        message: `Missing permission: ${permissionKey}`,
        code: "PERMISSION_DENIED",
        required: permissionKey,
      });
    }
    return next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireAdmin,
  requireStaff,
  requirePermission,
};
