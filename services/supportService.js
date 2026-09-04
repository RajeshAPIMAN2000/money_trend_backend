const pool = require("../config/db");
const { sanitizeText } = require("../utils/validators");
const { sendSupportTicketEmail, sendSupportStatusEmail, supportInbox } = require("./emailService");

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

const SUPPORT_STATUSES = ["pending", "in_process", "fixed"];

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

function normalizeStatus(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "inprocess" || value === "in_progress" || value === "processing") return "in_process";
  if (value === "resolved" || value === "done" || value === "closed") return "fixed";
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

  return {
    id: row.id,
    ticket_number: `MT-${row.id}`,
    user_id: row.user_id,
    subject: row.subject,
    description: row.description,
    attachment,
    status: row.status,
    status_label:
      row.status === "in_process" ? "In Process" : row.status === "fixed" ? "Fixed" : "Pending",
    admin_note: row.admin_note || null,
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

  return {
    ticket,
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
  let where = `user_id = :userId`;
  const normalized = status ? normalizeStatus(status) : null;
  if (normalized) {
    where += ` AND status = :status`;
    params.status = normalized;
  }

  const [rows] = await pool.query(
    `SELECT * FROM support_tickets
     WHERE ${where}
     ORDER BY id DESC
     LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM support_tickets WHERE ${where}`,
    params
  );

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    tickets: rows.map(formatTicket),
  };
}

async function getUserTicket(userId, ticketId) {
  const [rows] = await pool.query(
    `SELECT * FROM support_tickets WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id: ticketId, userId }
  );
  return formatTicket(rows[0] || null);
}

async function getTicketById(ticketId) {
  const [rows] = await pool.query(
    `SELECT t.*, u.full_name, u.email, u.phone
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     WHERE t.id = :id
     LIMIT 1`,
    { id: ticketId }
  );
  return formatTicket(rows[0] || null);
}

async function listAdminTickets({ status, search, limit = 50, offset = 0 } = {}) {
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

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name, u.email, u.phone
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY
       FIELD(t.status, 'pending', 'in_process', 'fixed'),
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
  const summary = { pending: 0, in_process: 0, fixed: 0 };
  for (const row of statusCounts) {
    if (summary[row.status] != null) summary[row.status] = Number(row.total);
  }

  return {
    count: rows.length,
    total: Number(countRows[0]?.total || 0),
    summary,
    tickets: rows.map(formatTicket),
  };
}

async function updateTicketStatus({ ticketId, status, adminNote, adminId }) {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    const err = new Error(`status must be one of: ${SUPPORT_STATUSES.join(", ")}`);
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

  return updated;
}

module.exports = {
  SUPPORT_SUBJECTS,
  SUPPORT_STATUSES,
  SUPPORT_FAQS,
  SUPPORT_STATS,
  createTicket,
  listUserTickets,
  getUserTicket,
  getTicketById,
  listAdminTickets,
  updateTicketStatus,
  normalizeStatus,
};
