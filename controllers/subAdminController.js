const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { writeAuditLog } = require("../utils/audit");
const { isValidEmail, isValidPhone, sanitizeText } = require("../utils/validators");
const {
  normalizePermissions,
  parsePermissionsJson,
  listAvailableRoles,
} = require("../services/staffPermissionService");

function mapSubAdmin(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    staff_active: row.staff_active == null ? true : Boolean(row.staff_active),
    roles: parsePermissionsJson(row.staff_permissions),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listAvailableSubAdminRoles(_req, res) {
  return res.json({
    success: true,
    message: "Available sub-admin roles",
    data: {
      roles: listAvailableRoles(),
      fields_required: ["full_name", "email", "password", "phone", "roles"],
    },
  });
}

async function listSubAdmins(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, role, staff_permissions, staff_active, created_at, updated_at
       FROM users
       WHERE role = 'sub_admin'
       ORDER BY id DESC`
    );
    return res.json({
      success: true,
      message: "Sub-admins fetched",
      data: { count: rows.length, sub_admins: rows.map(mapSubAdmin) },
    });
  } catch (error) {
    console.error("[SUB-ADMIN] list error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getSubAdminById(req, res) {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, role, staff_permissions, staff_active, created_at, updated_at
       FROM users WHERE id = :id AND role = 'sub_admin' LIMIT 1`,
      { id }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Sub-admin not found" });
    }
    return res.json({ success: true, data: mapSubAdmin(rows[0]) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function createSubAdmin(req, res) {
  try {
    const fullName = sanitizeText(req.body.full_name || req.body.fullName || req.body.name, 150);
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const phone = String(req.body.phone || req.body.mobile || "")
      .replace(/\s+/g, "")
      .trim();
    const roles = normalizePermissions(req.body.roles || req.body.permissions || req.body.role);

    if (!fullName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "full_name, email, password and phone are required",
        code: "VALIDATION_ERROR",
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone (10-digit Indian mobile starting 6-9)",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }
    if (!roles.length) {
      return res.status(400).json({
        success: false,
        message: "Assign at least one role: seo, blog, news, support",
        data: { available_roles: listAvailableRoles() },
      });
    }

    const [dup] = await pool.query(
      `SELECT id, role FROM users WHERE email = :email OR phone = :phone LIMIT 1`,
      { email, phone }
    );
    if (dup.length) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already registered",
        code: "DUPLICATE",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [ins] = await pool.query(
      `INSERT INTO users
        (full_name, email, password_hash, phone, role, kyc_status, staff_permissions, staff_active, email_verified_at)
       VALUES
        (:fullName, :email, :passwordHash, :phone, 'sub_admin', 'verified', :perms, 1, NOW())`,
      {
        fullName,
        email,
        passwordHash,
        phone,
        perms: JSON.stringify(roles),
      }
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "SUB_ADMIN_CREATED",
      entityType: "user",
      entityId: ins.insertId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { email, roles },
    });

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, role, staff_permissions, staff_active, created_at, updated_at
       FROM users WHERE id = :id`,
      { id: ins.insertId }
    );

    return res.status(201).json({
      success: true,
      message: "Sub-admin created successfully",
      data: mapSubAdmin(rows[0]),
    });
  } catch (error) {
    console.error("[SUB-ADMIN] create error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function updateSubAdmin(req, res) {
  try {
    const id = Number(req.params.id);
    const [existing] = await pool.query(
      `SELECT * FROM users WHERE id = :id AND role = 'sub_admin' LIMIT 1`,
      { id }
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: "Sub-admin not found" });
    }

    const fullName =
      req.body.full_name != null || req.body.fullName != null
        ? sanitizeText(req.body.full_name || req.body.fullName, 150)
        : existing[0].full_name;
    const email =
      req.body.email != null
        ? String(req.body.email).trim().toLowerCase()
        : existing[0].email;
    const phone =
      req.body.phone != null || req.body.mobile != null
        ? String(req.body.phone || req.body.mobile).replace(/\s+/g, "").trim()
        : existing[0].phone;
    const roles =
      req.body.roles != null || req.body.permissions != null
        ? normalizePermissions(req.body.roles || req.body.permissions)
        : parsePermissionsJson(existing[0].staff_permissions);
    const staffActive =
      req.body.staff_active != null || req.body.active != null
        ? Boolean(req.body.staff_active ?? req.body.active)
        : existing[0].staff_active == null
          ? true
          : Boolean(existing[0].staff_active);

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }
    if (!roles.length) {
      return res.status(400).json({
        success: false,
        message: "Assign at least one role: seo, blog, news, support",
      });
    }

    const [dup] = await pool.query(
      `SELECT id FROM users WHERE (email = :email OR phone = :phone) AND id <> :id LIMIT 1`,
      { email, phone, id }
    );
    if (dup.length) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already used by another account",
      });
    }

    const updates = {
      fullName,
      email,
      phone,
      perms: JSON.stringify(roles),
      staffActive: staffActive ? 1 : 0,
      id,
    };

    let passwordSql = "";
    if (req.body.password) {
      if (String(req.body.password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }
      updates.passwordHash = await bcrypt.hash(String(req.body.password), 10);
      passwordSql = `, password_hash = :passwordHash`;
    }

    await pool.query(
      `UPDATE users
       SET full_name = :fullName,
           email = :email,
           phone = :phone,
           staff_permissions = :perms,
           staff_active = :staffActive
           ${passwordSql}
       WHERE id = :id AND role = 'sub_admin'`,
      updates
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "SUB_ADMIN_UPDATED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { email, roles, staff_active: staffActive },
    });

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, role, staff_permissions, staff_active, created_at, updated_at
       FROM users WHERE id = :id`,
      { id }
    );
    return res.json({
      success: true,
      message: "Sub-admin updated",
      data: mapSubAdmin(rows[0]),
    });
  } catch (error) {
    console.error("[SUB-ADMIN] update error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteSubAdmin(req, res) {
  try {
    const id = Number(req.params.id);
    const [existing] = await pool.query(
      `SELECT id, email FROM users WHERE id = :id AND role = 'sub_admin' LIMIT 1`,
      { id }
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: "Sub-admin not found" });
    }

    await pool.query(`DELETE FROM users WHERE id = :id AND role = 'sub_admin'`, { id });

    await writeAuditLog({
      userId: req.user.id,
      action: "SUB_ADMIN_DELETED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { email: existing[0].email },
    });

    return res.json({ success: true, message: "Sub-admin deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  listAvailableSubAdminRoles,
  listSubAdmins,
  getSubAdminById,
  createSubAdmin,
  updateSubAdmin,
  deleteSubAdmin,
};
