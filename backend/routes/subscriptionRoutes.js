const express = require('express');

const { getMySubscription, upsertUserSubscription } = require('../controllers/subscriptionController');
const { protect } = require('../middleware/authMiddleware');
const { requireAdminControl } = require('../middleware/adminControlMiddleware');

const router = express.Router();

router.get('/me', protect, getMySubscription);
router.patch('/admin/update', requireAdminControl, upsertUserSubscription);

module.exports = router;
