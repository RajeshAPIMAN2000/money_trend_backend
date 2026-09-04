const {
  SUPPORT_SUBJECTS,
  SUPPORT_STATUSES,
  SUPPORT_FAQS,
  SUPPORT_STATS,
  createTicket,
  listUserTickets,
  getUserTicket,
  listAdminTickets,
  updateTicketStatus,
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
    const data = await listAdminTickets({
      status: req.query.status,
      search: req.query.search || req.query.q,
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
      adminNote: req.body.admin_note || req.body.adminNote || req.body.note,
      adminId: req.user.id,
    });
    return res.json({
      success: true,
      message: "Support ticket status updated",
      data: { ticket },
    });
  } catch (error) {
    if (error.code === "VALIDATION") {
      return res.status(400).json({
        success: false,
        message: error.message,
        allowed_statuses: SUPPORT_STATUSES,
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

module.exports = {
  getHelpMeta,
  submitTicket,
  listMyTickets,
  getMyTicket,
  adminListTickets,
  adminGetTicket,
  adminUpdateTicketStatus,
};
