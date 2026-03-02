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
    updateAvatar,
    updateNotificationPreferences,
    updatePrivacyPreferences,
    updateSecuritySettings,
    requestDataDownload,
    deleteAccount,
    getBillingOverview,
    getInvoices,
} = require('../controllers/settingsController');

const avatarUploadDir = path.join(__dirname, '../uploads/avatars');
fs.mkdirSync(avatarUploadDir, { recursive: true });
const avatarAllowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarUpload = multer({
    dest: avatarUploadDir,
    limits: {
        fileSize: Number.parseInt(process.env.AVATAR_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10),
    },
    fileFilter: (req, file, cb) => {
        if (avatarAllowedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported avatar format'));
    },
});

router.get('/', protect, getSettings);
router.get('/legal', protect, getLegalConfig);
router.put('/', protect, updateSettings);
router.post('/avatar', protect, (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Avatar exceeds size limit' });
        }
        return res.status(400).json({ message: error.message || 'Invalid avatar upload request' });
    });
}, updateAvatar);
router.post('/notification-preferences', protect, updateNotificationPreferences);
router.post('/privacy', protect, updatePrivacyPreferences);
router.post('/security', protect, updateSecuritySettings);
router.post('/data-download', protect, requestDataDownload);
router.delete('/account', protect, deleteAccount);
router.get('/billing-overview', protect, getBillingOverview);
router.get('/invoices', protect, getInvoices);

module.exports = router;
