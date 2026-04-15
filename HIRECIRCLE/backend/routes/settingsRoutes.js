const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const {
    getSettings,
    getLegalConfig,
    updateSettings,
    syncCloudAvatarUrl,
    updateNotificationPreferences,
    updatePrivacyPreferences,
    updateSecuritySettings,
    requestDataDownload,
    deleteAccount,
    getBillingOverview,
    getInvoices,
} = require('../controllers/settingsController');

router.get('/', protect, getSettings);
router.get('/legal', protect, getLegalConfig);
router.put('/', protect, updateSettings);
router.post('/avatar-url', protect, syncCloudAvatarUrl);
router.post('/notification-preferences', protect, updateNotificationPreferences);
router.post('/privacy', protect, updatePrivacyPreferences);
router.post('/security', protect, updateSecuritySettings);
router.post('/data-download', protect, requestDataDownload);
router.delete('/account', protect, deleteAccount);
router.get('/billing-overview', protect, getBillingOverview);
router.get('/invoices', protect, getInvoices);

module.exports = router;
