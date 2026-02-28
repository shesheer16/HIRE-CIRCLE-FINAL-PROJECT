const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
const { protect } = require('../middleware/authMiddleware');
const { uploadToS3 } = require('../services/s3Service');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const {
    enqueueInterviewJob,
    getInterviewQueueDepth,
    isQueueConfigured,
} = require('../services/sqsInterviewQueue');
const {
    toInterviewRole,
    buildInterviewIdempotencyKey,
    computeFileSha256,
    getDailyProcessingCount,
    trackInterviewEvent,
} = require('../services/interviewProcessingService');
const uploadRoutes = require('./uploadRoutes');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads/') });
const maxQueueDepth = Number.parseInt(process.env.INTERVIEW_QUEUE_MAX_DEPTH || '5000', 10);
const maxUploadSizeBytes = Number.parseInt(process.env.INTERVIEW_MAX_FILE_BYTES || String(150 * 1024 * 1024), 10);
const maxVideoDurationSeconds = Number.parseInt(process.env.INTERVIEW_MAX_DURATION_SECONDS || '180', 10);
const maxUploadsPerWindow = Number.parseInt(process.env.INTERVIEW_UPLOAD_RATE_LIMIT_COUNT || '3', 10);
const uploadRateWindowMs = Number.parseInt(process.env.INTERVIEW_UPLOAD_RATE_LIMIT_WINDOW_MS || String(10 * 60 * 1000), 10);
const dailyProcessingLimit = Number.parseInt(process.env.INTERVIEW_DAILY_LIMIT || '20000', 10);
const allowedMimeTypes = new Set(['video/mp4']);

ffmpeg.setFfmpegPath(ffmpegInstaller);
const { getSystemFlag } = require('../services/systemFlagService');
const { publishMetric } = require('../services/metricsService');

const probeDurationInSeconds = async (videoPath) => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(videoPath, (error, metadata) => {
            if (error) {
                resolve(null);
                return;
            }

            const duration = Number(metadata?.format?.duration);
            resolve(Number.isFinite(duration) ? duration : null);
        });
    });
};

const isLikelyMp4 = (filePath) => {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(64);
        fs.readSync(fd, buffer, 0, 64, 0);
        fs.closeSync(fd);
        return buffer.includes(Buffer.from('ftyp'));
    } catch (error) {
        return false;
    }
};

router.post('/video', protect, upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No video file provided.' });
    }

    if (!process.env.AWS_SQS_INTERVIEW_QUEUE_URL) {
        return uploadRoutes.handleVideoUpload(req, res);
    }

    const localVideoPath = req.file.path;
    const mimeType = req.file.mimetype || 'video/mp4';

    let idempotencyKey = null;
    let correlationId = null;
    let queueDepth = 0;

    try {
        const uploadsDisabled = await getSystemFlag('INTERVIEW_UPLOADS_DISABLED', String(process.env.INTERVIEW_UPLOADS_DISABLED || '').toLowerCase() === 'true');
        if (uploadsDisabled) {
            return res.status(503).json({
                success: false,
                error: 'High demand. Please try again shortly.',
            });
        }

        if (!allowedMimeTypes.has(mimeType)) {
            return res.status(400).json({
                success: false,
                error: 'Unsupported video format. Please upload an MP4 file.',
            });
        }

        if (!isLikelyMp4(localVideoPath)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid video file. Please upload a valid MP4.',
            });
        }

        if (Number(req.file.size || 0) > maxUploadSizeBytes) {
            return res.status(400).json({
                success: false,
                error: 'Video too large',
            });
        }

        const videoDuration = await probeDurationInSeconds(localVideoPath);
        if (Number.isFinite(videoDuration) && videoDuration > maxVideoDurationSeconds) {
            return res.status(400).json({
                success: false,
                error: 'Video too large',
            });
        }

        const recentUploadCount = await InterviewProcessingJob.countDocuments({
            userId: req.user._id,
            createdAt: { $gte: new Date(Date.now() - uploadRateWindowMs) },
        });
        if (recentUploadCount >= maxUploadsPerWindow) {
            await publishMetric({
                metricName: 'InterviewFailureCount',
                value: 1,
                role: 'system',
                correlationId: 'rate-limit',
                dimensions: { Reason: 'UploadRateLimit' },
            });
            return res.status(429).json({
                success: false,
                error: 'Too many interview uploads. Please try again in a few minutes.',
            });
        }

        const dailyCount = await getDailyProcessingCount();
        await publishMetric({
            metricName: 'InterviewDailyCount',
            value: dailyCount,
            role: 'system',
            correlationId: 'daily-count',
        });
        if (dailyCount >= dailyProcessingLimit) {
            await publishMetric({
                metricName: 'InterviewFailureCount',
                value: 1,
                role: 'system',
                correlationId: 'daily-limit',
                dimensions: { Reason: 'DailyLimitExceeded' },
            });
            return res.status(503).json({
                success: false,
                error: 'High demand. Please try again shortly.',
            });
        }

        const videoHash = await computeFileSha256(localVideoPath);
        idempotencyKey = buildInterviewIdempotencyKey({
            userId: req.user._id,
            videoHash,
        });

        const existing = await InterviewProcessingJob.findOne({ idempotencyKey })
            .sort({ createdAt: -1 })
            .select('_id videoUrl');
        if (existing) {
            correlationId = String(existing._id);
            console.log(JSON.stringify({
                metric: 'v2_upload_count',
                value: 1,
                type: 'deduplicated',
                correlationId,
                userId: String(req.user._id),
            }));
            await publishMetric({
                metricName: 'v2_upload_count',
                value: 1,
                role: toInterviewRole(req.user),
                correlationId,
                dimensions: { UploadType: 'deduplicated' },
            });
            await publishMetric({
                metricName: 'InterviewDailyCount',
                value: 1,
                role: toInterviewRole(req.user),
                correlationId,
                dimensions: { UploadVersion: 'v2_deduplicated' },
            });
            return res.status(200).json({
                success: true,
                processingId: existing._id,
                videoUrl: existing.videoUrl,
            });
        }

        if (!isQueueConfigured()) {
            return res.status(503).json({ success: false, error: 'Interview queue is not configured.' });
        }

        queueDepth = await getInterviewQueueDepth();
        if (queueDepth > maxQueueDepth) {
            return res.status(503).json({
                success: false,
                error: 'Interview queue is busy. Please try again shortly.',
            });
        }

        await publishMetric({
            metricName: 'InterviewQueueDepth',
            value: queueDepth,
            role: 'system',
            correlationId: 'pending',
        });

        const videoUrl = await uploadToS3(localVideoPath, mimeType, { prefix: 'interview-videos' });
        const role = toInterviewRole(req.user);

        const processingJob = await InterviewProcessingJob.create({
            userId: req.user._id,
            role,
            videoUrl,
            videoHash,
            idempotencyKey,
            status: 'pending',
        });
        correlationId = String(processingJob._id);

        await enqueueInterviewJob({
            processingId: String(processingJob._id),
            userId: String(req.user._id),
            role,
            videoUrl,
        });

        console.log(JSON.stringify({
            metric: 'v2_upload_count',
            value: 1,
            type: 'new',
            correlationId,
            userId: String(req.user._id),
        }));
        await publishMetric({
            metricName: 'v2_upload_count',
            value: 1,
            role,
            correlationId,
            dimensions: { UploadType: 'new' },
        });
        console.log(JSON.stringify({
            metric: 'queue_depth',
            value: queueDepth,
            correlationId,
        }));
        await publishMetric({
            metricName: 'InterviewDailyCount',
            value: 1,
            role,
            correlationId,
            dimensions: { UploadVersion: 'v2' },
        });
        await publishMetric({
            metricName: 'InterviewQueueDepth',
            value: queueDepth,
            role,
            correlationId,
        });

        await trackInterviewEvent({
            userId: req.user._id,
            eventName: 'INTERVIEW_PROCESSING_STARTED',
            processingId: processingJob._id,
            role,
            durationMs: 0,
        });

        return res.status(202).json({
            success: true,
            processingId: processingJob._id,
            videoUrl,
        });
    } catch (error) {
        if (error && error.code === 11000) {
            const existing = await InterviewProcessingJob.findOne({ idempotencyKey: idempotencyKey || error?.keyValue?.idempotencyKey || '' })
                .select('_id videoUrl');
            if (existing) {
                return res.status(200).json({
                    success: true,
                    processingId: existing._id,
                    videoUrl: existing.videoUrl,
                });
            }
        }

        console.warn(JSON.stringify({
            event: 'v2_upload_error',
            correlationId: correlationId || 'pending',
            message: error.message,
        }));
        return res.status(500).json({
            success: false,
            error: 'Failed to queue interview processing.',
        });
    } finally {
        if (fs.existsSync(localVideoPath)) {
            fs.unlinkSync(localVideoPath);
        }
    }
});

module.exports = router;
