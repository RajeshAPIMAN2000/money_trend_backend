const {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} = require("../services/notificationService");

async function listMyNotifications(req, res) {
  try {
    const unreadOnly = ["1", "true", "yes"].includes(
      String(req.query.unread || req.query.unread_only || "")
        .trim()
        .toLowerCase()
    );
    const data = await listNotifications(req.user.id, {
      unreadOnly,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      success: true,
      message: "Notifications fetched",
      data,
    });
  } catch (error) {
    console.error("[NOTIF] list error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
}

async function getMyUnreadCount(req, res) {
  try {
    const count = await getUnreadCount(req.user.id);
    return res.json({
      success: true,
      message: "Unread notification count",
      data: { unread_count: count },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
      error: error.message,
    });
  }
}

async function markNotificationRead(req, res) {
  try {
    const data = await markRead(req.user.id, req.params.id);
    return res.json({
      success: true,
      message: "Notification marked as read",
      data,
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification read",
      error: error.message,
    });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    const data = await markAllRead(req.user.id);
    return res.json({
      success: true,
      message: "All notifications marked as read",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark all notifications read",
      error: error.message,
    });
  }
}

module.exports = {
  listMyNotifications,
  getMyUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};
