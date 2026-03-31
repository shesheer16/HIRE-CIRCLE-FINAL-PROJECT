const express = require('express');

const { protect } = require('../middleware/authMiddleware');
const {
    getPrivacyPolicy,
    updateConsent,
    scheduleAccountDeletion,
    getDeletionStatus,
} = require('../controllers/privacyController');

const router = express.Router();

router.get('/policy', getPrivacyPolicy);
router.post('/consent', protect, updateConsent);
router.get('/deletion-status', protect, getDeletionStatus);
router.post('/schedule-delete', protect, scheduleAccountDeletion);

module.exports = router;
