/** Staff (admin / sub_admin) permission keys for panel modules. */
const STAFF_PERMISSIONS = [
  {
    key: "seo",
    label: "SEO Management",
    description: "Page titles, descriptions, Google Analytics, sitemap.xml, robots.txt",
  },
  {
    key: "blog",
    label: "Blog Management",
    description: "Create/edit blogs (Sub Admin posts need Admin approval)",
  },
  {
    key: "news",
    label: "News Management",
    description: "Create/edit news (Sub Admin posts need Admin approval)",
  },
  {
    key: "support",
    label: "Customer Support",
    description: "View user issues, reply by email, update ticket status (pending / in process / resolved)",
  },
];

const PERMISSION_KEYS = STAFF_PERMISSIONS.map((p) => p.key);

function normalizePermissions(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,|]/).map((s) => s.trim())
      : [];

  const normalized = [
    ...new Set(
      list
        .map((raw) =>
          String(raw || "")
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_")
            .replace(/_management$/, "")
        )
        .map((key) => {
          if (key === "seo_management" || key === "seo") return "seo";
          if (key === "blog_management" || key === "blogs" || key === "blog") return "blog";
          if (key === "news_management" || key === "news") return "news";
          if (
            key === "support" ||
            key === "customer_support" ||
            key === "support_panel" ||
            key === "tickets" ||
            key === "helpdesk"
          ) {
            return "support";
          }
          return key;
        })
        .filter((key) => PERMISSION_KEYS.includes(key))
    ),
  ];

  return normalized;
}

function parsePermissionsJson(value) {
  if (Array.isArray(value)) return normalizePermissions(value);
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try {
      return normalizePermissions(JSON.parse(value));
    } catch (_e) {
      return normalizePermissions(value);
    }
  }
  return [];
}

function listAvailableRoles() {
  return STAFF_PERMISSIONS;
}

function isFullAdmin(user) {
  return user && user.role === "admin";
}

function isStaff(user) {
  return user && (user.role === "admin" || user.role === "sub_admin");
}

function hasPermission(user, permissionKey) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "sub_admin") return false;
  const perms = Array.isArray(user.permissions)
    ? user.permissions
    : parsePermissionsJson(user.permissions);
  return perms.includes(permissionKey);
}

module.exports = {
  STAFF_PERMISSIONS,
  PERMISSION_KEYS,
  normalizePermissions,
  parsePermissionsJson,
  listAvailableRoles,
  isFullAdmin,
  isStaff,
  hasPermission,
};
