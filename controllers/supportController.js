const {
  SUPPORT_SUBJECTS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_FAQS,
  SUPPORT_STATS,
  createTicket,
  listUserTickets,
  getUserTicket,
  listAdminTickets,
  listSupportAgents,
  assignTicket,
  updateTicketStatus,
  replyToTicket,
} = require("../services/supportService");

function getHelpMeta(_req, res) {
  return res.json({
    success: true,
    message: "Support help center meta",
    data: {
      title: "How Can We Help You?",
      inbox: process.env.SUPPORT_EMAIL || "info@moneytrend.in",
      subjects: SUPPORT_SUBJECTS,
      statuses: SUPPORT_STATUSES,
      status_labels: SUPPORT_STATUS_LABELS,
      stages: SUPPORT_STATUS_LABELS,
      stats: SUPPORT_STATS,
      faqs: SUPPORT_FAQS,
      actions: {
        live_chat: { label: "Live Chat", available: false, note: "Coming soon" },
        expert_advisors: { label: "Expert Advisors", available: false, note: "Coming soon" },
      },
    },
  });
}

async function submitTicket(req, res) {
  console.log("[SUPPORT] submit body:", {
    ...req.body,
    description: req.body?.description ? "[truncated]" : undefined,
    file: req.file?.filename,
  });
  try {
    const subject = req.body.subject || req.body.category;
    const description = req.body.description || req.body.message || req.body.issue;
    const attachment = req.file ? req.file.filename : null;

    const result = await createTicket({
      userId: req.user.id,
      subject,
      description,
      attachment,
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket submitted. Our team will respond shortly.",
      data: result,
    });
  } catch (error) {
    if (error.code === "VALIDATION") {
      return res.status(400).json({
        success: false,
        message: error.message,
        allowed_subjects: SUPPORT_SUBJECTS,
      });
    }
    console.error("[SUPPORT] submit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit support ticket",
      error: error.message,
    });
  }
}

async function listMyTickets(req, res) {
  try {
    const data = await listUserTickets(req.user.id, {
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      success: true,
      message: "Your support tickets",
      data,
    });
  } catch (error) {
    console.error("[SUPPORT] list my tickets error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch support tickets",
      error: error.message,
    });
  }
}

async function getMyTicket(req, res) {
  try {
    const ticket = await getUserTicket(req.user.id, Number(req.params.id));
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }
    return res.json({
      success: true,
      message: "Support ticket detail",
      data: { ticket },
    });
  } catch (error) {
    console.error("[SUPPORT] get my ticket error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch support ticket",
      error: error.message,
    });
  }
}

async function adminListTickets(req, res) {
  try {
    const isFullAdmin = req.user?.role === "admin";
    const data = await listAdminTickets({
      status: req.query.status,
      search: req.query.search || req.query.q,
      // Sub-admin support agents only see tickets assigned to them
      assignedTo: isFullAdmin
        ? req.query.assigned_to || req.query.assignedTo || undefined
        : req.user.id,
      unassignedOnly:
        isFullAdmin &&
        ["1", "true", "yes"].includes(
          String(req.query.unassigned || req.query.unassigned_only || "")
            .trim()
            .toLowerCase()
        ),
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      success: true,
      message: "Support tickets fetched",
      data,
    });
  } catch (error) {
    console.error("[SUPPORT] admin list error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch support tickets",
      error: error.message,
    });
  }
}

async function adminListSupportAgents(req, res) {
  try {
    const data = await listSupportAgents();
    return res.json({
      success: true,
      message: "Customer support agents availability",
      data,
    });
  } catch (error) {
    console.error("[SUPPORT] agents list error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch support agents",
      error: error.message,
    });
  }
}

async function adminAssignTicket(req, res) {
  console.log("[SUPPORT] admin assign:", req.params.id, req.body);
  try {
    const agentId =
      req.body.assigned_to ||
      req.body.assignedTo ||
      req.body.agent_id ||
      req.body.agentId ||
      req.body.support_id ||
      req.body.supportId;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: "assigned_to (customer support agent id) is required",
      });
    }

    const result = await assignTicket({
      ticketId: Number(req.params.id),
      agentId: Number(agentId),
      assignedBy: req.user.id,
      notifyUser: true,
    });

    return res.json({
      success: true,
      message: "Ticket assigned to customer support. User notified by email.",
      data: result,
    });
  } catch (error) {
    if (error.code === "VALIDATION") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("[SUPPORT] assign error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to assign support ticket",
      error: error.message,
    });
  }
}

async function adminGetTicket(req, res) {
  try {
    const { getTicketById } = require("../services/supportService");
    const ticket = await getTicketById(Number(req.params.id));
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }
    return res.json({
      success: true,
      message: "Support ticket detail",
      data: { ticket },
    });
  } catch (error) {
    console.error("[SUPPORT] admin get error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch support ticket",
      error: error.message,
    });
  }
}

async function adminUpdateTicketStatus(req, res) {
  console.log("[SUPPORT] admin status update:", req.params.id, req.body);
  try {
    const ticket = await updateTicketStatus({
      ticketId: Number(req.params.id),
      status: req.body.status,
      adminNote: req.body.admin_note || req.body.adminNote || req.body.note || req.body.reply,
      adminId: req.user.id,
    });
    return res.json({
      success: true,
      message: "Support ticket status updated. User notified by email.",
      data: { ticket },
    });
  } catch (error) {
    if (error.code === "VALIDATION") {
      return res.status(400).json({
        success: false,
        message: error.message,
        allowed_statuses: SUPPORT_STATUSES,
        status_labels: SUPPORT_STATUS_LABELS,
      });
    }
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("[SUPPORT] admin update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update support ticket",
      error: error.message,
    });
  }
}

async function adminReplyTicket(req, res) {
  console.log("[SUPPORT] admin reply:", req.params.id, {
    ...req.body,
    reply: req.body?.reply || req.body?.description ? "[truncated]" : undefined,
  });
  try {
    const result = await replyToTicket({
      ticketId: Number(req.params.id),
      reply:
        req.body.reply ||
        req.body.description ||
        req.body.message ||
        req.body.admin_note ||
        req.body.adminNote ||
        req.body.note,
      status: req.body.status,
      adminId: req.user.id,
    });
    return res.json({
      success: true,
      message: "Support reply saved and emailed to the user",
      data: result,
    });
  } catch (error) {
    if (error.code === "VALIDATION") {
      return res.status(400).json({
        success: false,
        message: error.message,
        allowed_statuses: SUPPORT_STATUSES,
        status_labels: SUPPORT_STATUS_LABELS,
      });
    }
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("[SUPPORT] admin reply error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reply to support ticket",
      error: error.message,
    });
  }
}

module.exports = {
  getHelpMeta,
  submitTicket,
  listMyTickets,
  getMyTicket,
  adminListTickets,
  adminGetTicket,
  adminListSupportAgents,
  adminAssignTicket,
  adminUpdateTicketStatus,
  adminReplyTicket,
};
