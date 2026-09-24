const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  listMyNotifications,
  getMyUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(authenticate);

router.get("/", listMyNotifications);
router.get("/unread-count", getMyUnreadCount);
router.patch("/:id/read", markNotificationRead);
router.post("/read-all", markAllNotificationsRead);
router.patch("/read-all", markAllNotificationsRead);

module.exports = router;
