const express = require('express');
const multer = require('multer');
const path = require('path');

const { protect } = require('../middleware/authMiddleware');
const { smartInterviewStartLimiter } = require('../middleware/rateLimiters');
const uploadRoutes = require('./uploadRoutes');
const { getSystemFlag } = require('../services/systemFlagService');
const { isDegradationActive } = require('../services/degradationService');

const router = express.Router();

const maxUploadSizeBytes = Number.parseInt(process.env.INTERVIEW_MAX_FILE_BYTES || String(150 * 1024 * 1024), 10);
const allowedMimeTypes = new Set(['video/mp4']);

const upload = multer({
    dest: path.join(__dirname, '../uploads/'),
    limits: {
        fileSize: maxUploadSizeBytes,
    },
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported video format. Please upload an MP4 file.'));
    },
});

router.post('/video', protect, smartInterviewStartLimiter, (req, res, next) => {
    upload.single('video')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'Video too large' });
        }

        return res.status(400).json({ success: false, error: error.message || 'Invalid upload request.' });
    });
}, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No video file provided.' });
    }

    if (isDegradationActive('queuePaused') || isDegradationActive('smartInterviewPaused')) {
        return res.status(503).json({
            success: false,
            error: 'Smart Interview is temporarily paused due to system load. Please retry shortly.',
        });
    }

    const uploadsDisabled = await getSystemFlag(
        'INTERVIEW_UPLOADS_DISABLED',
        String(process.env.INTERVIEW_UPLOADS_DISABLED || '').toLowerCase() === 'true'
    );
    if (uploadsDisabled) {
        return res.status(503).json({
            success: false,
            error: 'High demand. Please try again shortly.',
        });
    }

    return uploadRoutes.handleVideoUpload(req, res);
});

module.exports = router;
