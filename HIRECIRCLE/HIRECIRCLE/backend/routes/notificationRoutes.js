const express = require('express');
const router = express.Router();
const { getMyNotifications, markNotificationRead, markAllNotificationsRead, clearAllNotifications, registerPushToken } = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
    .get(protect, getMyNotifications)
    .put(protect, markAllNotificationsRead)
    .delete(protect, clearAllNotifications);

router.put('/:id/read', protect, markNotificationRead);
router.post('/register-token', protect, registerPushToken);

module.exports = router;
