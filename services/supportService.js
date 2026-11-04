const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");
const { parsePermissionsJson } = require("./staffPermissionService");
const {
  sendSupportTicketEmail,
  sendSupportStatusEmail,
  sendSupportReplyEmail,
  sendSupportAssignedEmail,
  supportInbox,
} = require("./emailService");
const {
  safeNotify,
  notifyUser: notifyEndUser,
  notifyAdmins,
  notifyCustomerSupport,
} = require("./notificationService");

const SUPPORT_SUBJECTS = [
  "Technical Issue",
  "Account / Login",
  "KYC Verification",
  "FD / RD Investment",
  "Wallet / Payments",
  "Withdrawal",
  "Bank Account",
  "Credit Score / CIBIL",
  "Charges / Fees",
  "Other",
];

/** Canonical DB statuses. "resolved" maps to fixed. */
const SUPPORT_STATUSES = ["pending", "in_process", "fixed"];

const SUPPORT_STATUS_LABELS = {
  pending: "Pending",
  in_process: "In Process",
  fixed: "Resolved",
};

const SUPPORT_FAQS = [
  {
    id: 1,
    question: "How do I create a Money Trend account?",
    answer:
      "Register with your full name, email, password, phone and date of birth. Complete KYC and add a nominee to start investing in FD/RD.",
  },
  {
    id: 2,
    question: "Is Money Trend SEBI registered?",
    answer:
      "Money Trend follows applicable SEBI/RBI-aligned compliance practices for KYC, nominee, and investment flows on the platform.",
  },
  {
    id: 3,
    question: "How long does KYC take?",
    answer:
      "Manual KYC is usually reviewed within 1–2 business days after documents are submitted. DigiLocker KYC is typically faster when available.",
  },
  {
    id: 4,
    question: "What documents are required for KYC?",
    answer: "PAN card and Aadhaar (images) plus personal details matching your registered profile.",
  },
  {
    id: 5,
    question: "How long do withdrawals take?",
    answer:
      "Withdrawals are credited to your registered bank account after admin verification. Timing depends on bank processing and verification checks.",
  },
  {
    id: 6,
    question: "Are there hidden charges?",
    answer:
      "Investment platform fees (admin commission within the configured band) are shown at booking time. There are no undisclosed wallet deposit charges from Money Trend beyond payment gateway norms.",
  },
  {
    id: 7,
    question: "How safe are my funds?",
    answer:
      "Wallet balance is used for FD/RD bookings on Money Trend. Bank account details are stored encrypted; withdrawals require a verified bank account.",
  },
  {
    id: 8,
    question: "Can NRIs invest?",
    answer:
      "Please contact support with your residency details. Availability depends on product/bank eligibility and KYC requirements.",
  },
  {
    id: 9,
    question: "How do I update my bank account?",
    answer: "Go to Profile → Bank Account and submit account holder name, bank, branch, IFSC and account number.",
  },
];

const SUPPORT_STATS = {
  avg_response: "2 hrs",
  satisfaction: "98%",
  availability: "24x7",
  resolved: "50K+",
};

const TICKET_SELECT = `
  SELECT t.*,
         u.full_name, u.email, u.phone,
         a.id AS assignee_id,
         a.full_name AS assignee_name,
         a.email AS assignee_email,
         a.phone AS assignee_phone
  FROM support_tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users a ON a.id = t.assigned_to
`;

function statusLabel(status) {
  return SUPPORT_STATUS_LABELS[status] || "Pending";
}

function normalizeStatus(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "inprocess" || value === "in_progress" || value === "processing") return "in_process";
  if (value === "resolved" || value === "done" || value === "closed" || value === "complete") {
    return "fixed";
  }
  if (SUPPORT_STATUSES.includes(value)) return value;
  return null;
}

function formatTicket(row) {
  if (!row) return null;
  const attachment = row.attachment
    ? String(row.attachment).startsWith("/uploads/")
      ? row.attachment
      : `/uploads/${row.attachment}`
    : null;

  const label = statusLabel(row.status);
  const assignedTo = row.assigned_to || row.assignee_id || null;

  return {
    id: row.id,
    ticket_number: `MT-${row.id}`,
    user_id: row.user_id,
    subject: row.subject,
    description: row.description,
    attachment,
    status: row.status,
    status_label: label,
    stage: label,
    admin_note: row.admin_note || null,
    support_reply: row.admin_note || null,
    assigned_to: assignedTo,
    assigned_at: row.assigned_at || null,
    assignee: assignedTo
      ? {
          id: assignedTo,
          full_name: row.assignee_name || null,
          email: row.assignee_email || null,
          phone: row.assignee_phone || null,
        }
      : null,
    resolved_at: row.resolved_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: row.full_name
      ? {
          id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
        }
      : undefined,
  };
}

function hasSupportPermission(staffPermissions) {
  return parsePermissionsJson(staffPermissions).includes("support");
}

/**
 * Customer support agents with busy/free status.
 * Busy = has at least one open (pending/in_process) assigned ticket.
 */
async function listSupportAgents() {
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, staff_permissions, staff_active, created_at
     FROM users
     WHERE role = 'sub_admin'
       AND (staff_active IS NULL OR staff_active = 1)
     ORDER BY full_name ASC`
  );

  const agents = rows.filter((row) => hasSupportPermission(row.staff_permissions));
  if (!agents.length) {
    return {
      count: 0,
      free_count: 0,
      busy_count: 0,
      auto_assign_eligible: false,
      manual_assign_required: false,
      agents: [],
      free: [],
      busy: [],
    };
  }

  const ids = agents.map((a) => a.id);
  const [openCounts] = await pool.query(
    `SELECT assigned_to AS agent_id, COUNT(*) AS open_tickets
     FROM support_tickets
     WHERE assigned_to IN (${ids.map(() => "?").join(",")})
       AND status IN ('pending', 'in_process')
     GROUP BY assigned_to`,
    ids
  );

  const openMap = {};
  for (const row of openCounts) {
    openMap[Number(row.agent_id)] = Number(row.open_tickets || 0);
  }

  const formatted = agents.map((agent) => {
    const openTickets = openMap[agent.id] || 0;
    const availability = openTickets > 0 ? "busy" : "free";
    return {
      id: agent.id,
      full_name: agent.full_name,
      email: agent.email,
      phone: agent.phone,
      availability,
      is_free: availability === "free",
      is_busy: availability === "busy",
      open_tickets: openTickets,
    };
  });

  const free = formatted.filter((a) => a.is_free);
  const busy = formatted.filter((a) => a.is_busy);

  return {
    count: formatted.length,
    free_count: free.length,
    busy_count: busy.length,
    /** Exactly one free agent → new tickets auto-assign */
    auto_assign_eligible: free.length === 1,
    /** Multiple free agents → admin assigns manually */
    manual_assign_required: free.length > 1,
    agents: formatted,
    free,
    busy,
  };
}

async function getSupportAgentById(agentId) {
  const id = Number(agentId);
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, role, staff_permissions, staff_active
     FROM users WHERE id = :id LIMIT 1`,
    { id }
  );
  const agent = rows[0];
  if (!agent) return null;
  if (agent.role !== "sub_admin") return null;
  if (agent.staff_active === 0) return null;
  if (!hasSupportPermission(agent.staff_permissions)) return null;
  return agent;
}

async function assignTicket({ ticketId, agentId, assignedBy, notifyUser = true }) {
  const existing = await getTicketById(ticketId);
  if (!existing) {
    const err = new Error("Support ticket not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  if (existing.status === "fixed") {
    const err = new Error("Cannot assign a resolved ticket. Re-open it first if needed.");
    err.code = "VALIDATION";
    throw err;
  }

  const agent = await getSupportAgentById(agentId);
  if (!agent) {
    const err = new Error("Assigned user must be an active Customer Support agent");
    err.code = "VALIDATION";
    throw err;
  }

  await pool.query(
    `UPDATE support_tickets
     SET assigned_to = :agentId,
         assigned_at = NOW(),
         updated_by = :assignedBy,
         status = CASE WHEN status = 'pending' THEN 'in_process' ELSE status END
     WHERE id = :id`,
    {
      id: ticketId,
      agentId: agent.id,
      assignedBy: assignedBy || null,
    }
  );

  const updated = await getTicketById(ticketId);

  let emailResult = null;
  if (notifyUser) {
    try {
      emailResult = await sendSupportAssignedEmail({
        ticket: {
          id: updated.id,
          subject: updated.subject,
          status: updated.status,
        },
        user: updated.user,
        agent: {
          id: agent.id,
          full_name: agent.full_name,
          email: agent.email,
        },
      });
    } catch (mailErr) {
      console.error("[SUPPORT] assignment email failed:", mailErr.message);
      emailResult = { sent: false, error: mailErr.message };
    }
  }

  safeNotify(async () => {
    if (updated.user?.id) {
      await notifyEndUser(updated.user.id, {
        eventType: "support_assigned",
        title: "Support agent assigned",
        body: `${agent.full_name} has been assigned to your ticket #${updated.id} (${updated.subject}).`,
        referenceType: "support_ticket",
        referenceId: updated.id,
        meta: { agent_name: agent.full_name, status: updated.status },
      });
    }
    await notifyCustomerSupport(
      {
        eventType: "support_ticket_assigned",
        title: `Ticket #${updated.id} assigned to you`,
        body: `${updated.subject} — ${updated.user?.full_name || "User"}`,
        referenceType: "support_ticket",
        referenceId: updated.id,
        meta: { user_id: updated.user_id },
      },
      { onlyUserIds: [agent.id] }
    );
  });

  return {
    ticket: updated,
    agent: {
      id: agent.id,
      full_name: agent.full_name,
      email: agent.email,
      phone: agent.phone,
      availability: "busy",
    },
    email: {
      to: updated.user?.email || null,
      ...emailResult,
    },
  };
}

/**
 * Auto-assign only when exactly one support agent is free.
 * If 0 free → leave unassigned. If 2+ free → admin assigns manually.
 */
async function tryAutoAssignTicket(ticketId) {
  const availability = await listSupportAgents();
  if (availability.free_count !== 1) {
    return {
      assigned: false,
      reason:
        availability.free_count === 0
          ? "no_free_agents"
          : "multiple_free_agents_manual_assign",
      free_count: availability.free_count,
      free: availability.free,
    };
  }

  const agent = availability.free[0];
  const result = await assignTicket({
    ticketId,
    agentId: agent.id,
    assignedBy: null,
    notifyUser: true,
  });

  return {
    assigned: true,
    reason: "auto_assigned_single_free_agent",
    ...result,
  };
}

async function createTicket({ userId, subject, description, attachment }) {
  const cleanSubject = sanitizeText(subject, 150);
  const cleanDescription = String(description || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 5000);

  if (!cleanSubject || !cleanDescription) {
    const err = new Error("subject and description are required");
    err.code = "VALIDATION";
    throw err;
  }

  const [result] = await pool.query(
    `INSERT INTO support_tickets (user_id, subject, description, attachment, status)
     VALUES (:userId, :subject, :description, :attachment, 'pending')`,
    {
      userId,
      subject: cleanSubject,
      description: cleanDescription,
      attachment: attachment || null,
    }
  );

  const ticketId = result.insertId;

  let assignment = null;
  try {
    assignment = await tryAutoAssignTicket(ticketId);
  } catch (assignErr) {
    console.error("[SUPPORT] auto-assign failed:", assignErr.message);
    assignment = { assigned: false, reason: "auto_assign_error", error: assignErr.message };
  }

  const ticket = await getTicketById(ticketId);

  const [users] = await pool.query(
    `SELECT id, full_name, email, phone FROM users WHERE id = :userId LIMIT 1`,
    { userId }
  );

  let emailResult = null;
  try {
    emailResult = await sendSupportTicketEmail({
      ticket: {
        id: ticket.id,
        user_id: userId,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        created_at: ticket.created_at,
      },
      user: users[0],
      attachmentPath: attachment,
    });
  } catch (mailErr) {
    console.error("[SUPPORT] email failed (ticket still saved):", mailErr.message);
    emailResult = { sent: false, error: mailErr.message };
  }

  safeNotify(async () => {
    await notifyEndUser(userId, {
      eventType: "support_ticket_created",
      title: "Support ticket submitted",
      body: `Ticket #${ticket.id}: ${ticket.subject}. Our team will respond shortly.`,
      referenceType: "support_ticket",
      referenceId: ticket.id,
      meta: { status: ticket.status },
    });
    await notifyAdmins({
      eventType: "support_ticket_created",
      title: `New support ticket #${ticket.id}`,
      body: `${ticket.subject} — ${users[0]?.full_name || "User"}`,
      referenceType: "support_ticket",
      referenceId: ticket.id,
      meta: { user_id: userId, assigned: Boolean(assignment?.assigned) },
    });
    if (!assignment?.assigned) {
      await notifyCustomerSupport({
        eventType: "support_ticket_created",
        title: `New support ticket #${ticket.id}`,
        body: `${ticket.subject} — awaiting assignment`,
        referenceType: "support_ticket",
        referenceId: ticket.id,
        meta: { user_id: userId },
      });
    }
  });

  return {
    ticket,
    assignment,
    email: {
      to: supportInbox(),
      ...emailResult,
    },
  };
}

async function listUserTickets(userId, { status, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const params = { userId };
  let where = `t.user_id = :userId`;
  const normalized = status ? normalizeStatus(status) : null;
  if (normalized) {
    where += ` AND t.status = :status`;
    params.status = normalized;
  }

  const [rows] = await pool.query(
    `${TICKET_SELECT}
     WHERE ${where}
     ORDER BY t.id DESC
     LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM support_tickets t WHERE ${where}`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    stages: SUPPORT_STATUS_LABELS,
    tickets: rows.map(formatTicket),
  };
}

async function getUserTicket(userId, ticketId) {
  const [rows] = await pool.query(
    `${TICKET_SELECT}
     WHERE t.id = :id AND t.user_id = :userId
     LIMIT 1`,
    { id: ticketId, userId }
  );
  return formatTicket(rows[0] || null);
}

async function getTicketById(ticketId) {
  const [rows] = await pool.query(
    `${TICKET_SELECT}
     WHERE t.id = :id
     LIMIT 1`,
    { id: ticketId }
  );
  return formatTicket(rows[0] || null);
}

async function listAdminTickets({
  status,
  search,
  assignedTo,
  unassignedOnly = false,
  limit = 50,
  offset = 0,
} = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const params = {};
  const clauses = [];

  const normalized = status ? normalizeStatus(status) : null;
  if (normalized) {
    clauses.push(`t.status = :status`);
    params.status = normalized;
  }
  if (search) {
    clauses.push(
      `(t.subject LIKE :q OR t.description LIKE :q OR u.email LIKE :q OR u.full_name LIKE :q OR u.phone LIKE :q)`
    );
    params.q = `%${String(search).trim()}%`;
  }
  if (unassignedOnly) {
    clauses.push(`t.assigned_to IS NULL`);
  } else if (assignedTo) {
    clauses.push(`t.assigned_to = :assignedTo`);
    params.assignedTo = Number(assignedTo);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `${TICKET_SELECT}
     ${where}
     ORDER BY
       FIELD(t.status, 'pending', 'in_process', 'fixed'),
       (t.assigned_to IS NULL) DESC,
       t.id DESC
     LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     ${where}`,
    params
  );

  const [statusCounts] = await pool.query(
    `SELECT status, COUNT(*) AS total FROM support_tickets GROUP BY status`
  );
  const summary = { pending: 0, in_process: 0, fixed: 0, unassigned: 0 };
  for (const row of statusCounts) {
    if (summary[row.status] != null) summary[row.status] = Number(row.total);
  }
  const [unassignedRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM support_tickets
     WHERE assigned_to IS NULL AND status IN ('pending', 'in_process')`
  );
  summary.unassigned = Number(unassignedRows[0]?.total || 0);

  const agents = await listSupportAgents();

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    summary,
    stages: SUPPORT_STATUS_LABELS,
    agents: {
      free_count: agents.free_count,
      busy_count: agents.busy_count,
      auto_assign_eligible: agents.auto_assign_eligible,
      manual_assign_required: agents.manual_assign_required,
      free: agents.free,
      busy: agents.busy,
    },
    tickets: rows.map(formatTicket),
  };
}

async function updateTicketStatus({ ticketId, status, adminNote, adminId }) {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    const err = new Error(
      `status must be one of: pending, in_process, fixed (resolved also accepted)`
    );
    err.code = "VALIDATION";
    throw err;
  }

  const existing = await getTicketById(ticketId);
  if (!existing) {
    const err = new Error("Support ticket not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const note = adminNote != null ? sanitizeText(adminNote, 2000) || null : existing.admin_note;

  await pool.query(
    `UPDATE support_tickets
     SET status = :status,
         admin_note = :adminNote,
         resolved_at = CASE
           WHEN :status = 'fixed' THEN COALESCE(resolved_at, NOW())
           ELSE NULL
         END,
         updated_by = :adminId
     WHERE id = :id`,
    {
      id: ticketId,
      status: normalized,
      adminNote: note,
      adminId: adminId || null,
    }
  );

  const updated = await getTicketById(ticketId);

  try {
    await sendSupportStatusEmail({
      ticket: {
        id: updated.id,
        subject: updated.subject,
        status: updated.status,
        admin_note: updated.admin_note,
      },
      user: updated.user,
    });
  } catch (mailErr) {
    console.error("[SUPPORT] status email failed:", mailErr.message);
  }

  safeNotify(async () => {
    if (updated.user?.id) {
      await notifyEndUser(updated.user.id, {
        eventType: "support_status_changed",
        title: `Ticket #${updated.id} is now ${updated.stage || updated.status_label}`,
        body: updated.admin_note
          ? `Support update: ${updated.admin_note}`
          : `Your support ticket (${updated.subject}) stage is ${updated.stage}.`,
        referenceType: "support_ticket",
        referenceId: updated.id,
        meta: { status: updated.status, stage: updated.stage },
      });
    }
  });

  return updated;
}

/**
 * Support agent guides the user: save reply + optional status, email user.
 * If status omitted and ticket is still pending → moves to in_process.
 */
async function replyToTicket({ ticketId, reply, status, adminId }) {
  const cleanReply = String(reply || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 2000);

  if (!cleanReply) {
    const err = new Error("reply (description/guidance for the user) is required");
    err.code = "VALIDATION";
    throw err;
  }

  const existing = await getTicketById(ticketId);
  if (!existing) {
    const err = new Error("Support ticket not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  let nextStatus = existing.status;
  if (status != null && String(status).trim() !== "") {
    const normalized = normalizeStatus(status);
    if (!normalized) {
      const err = new Error(
        `status must be one of: pending, in_process, fixed (resolved also accepted)`
      );
      err.code = "VALIDATION";
      throw err;
    }
    nextStatus = normalized;
  } else if (existing.status === "pending") {
    nextStatus = "in_process";
  }

  await pool.query(
    `UPDATE support_tickets
     SET status = :status,
         admin_note = :adminNote,
         resolved_at = CASE
           WHEN :status = 'fixed' THEN COALESCE(resolved_at, NOW())
           ELSE NULL
         END,
         updated_by = :adminId
     WHERE id = :id`,
    {
      id: ticketId,
      status: nextStatus,
      adminNote: cleanReply,
      adminId: adminId || null,
    }
  );

  const updated = await getTicketById(ticketId);

  let emailResult = null;
  try {
    emailResult = await sendSupportReplyEmail({
      ticket: {
        id: updated.id,
        subject: updated.subject,
        status: updated.status,
        admin_note: updated.admin_note,
        description: updated.description,
      },
      user: updated.user,
      reply: cleanReply,
    });
  } catch (mailErr) {
    console.error("[SUPPORT] reply email failed:", mailErr.message);
    emailResult = { sent: false, error: mailErr.message };
  }

  safeNotify(async () => {
    if (updated.user?.id) {
      await notifyEndUser(updated.user.id, {
        eventType: "support_replied",
        title: `Support replied on ticket #${updated.id}`,
        body: cleanReply.slice(0, 300),
        referenceType: "support_ticket",
        referenceId: updated.id,
        meta: { status: updated.status, stage: updated.stage },
      });
    }
  });

  return {
    ticket: updated,
    email: {
      to: updated.user?.email || null,
      ...emailResult,
    },
  };
}

module.exports = {
  SUPPORT_SUBJECTS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_FAQS,
  SUPPORT_STATS,
  createTicket,
  listUserTickets,
  getUserTicket,
  getTicketById,
  listAdminTickets,
  listSupportAgents,
  assignTicket,
  tryAutoAssignTicket,
  updateTicketStatus,
  replyToTicket,
  normalizeStatus,
  statusLabel,
};
