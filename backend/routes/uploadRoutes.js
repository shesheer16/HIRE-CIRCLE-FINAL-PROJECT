const express = require('express');
const router = express.Router();
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegInstaller);
const fs = require('fs');
const path = require('path');
const { extractWorkerDataFromAudio } = require('../services/geminiService');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const User = require('../models/userModel');
const { protect } = require('../middleware/authMiddleware');
const { uploadToS3, resolveObjectFromSignedToken } = require('../services/s3Service');
const { publishMetric } = require('../services/metricsService');
const { isRecruiter } = require('../utils/roleGuards');
const logger = require('../utils/logger');
const { ensureExtensionMatchesMime, isValidMp4Signature, runVirusScanHook } = require('../services/uploadSecurityService');

const maxUploadSizeBytes = Number.parseInt(process.env.INTERVIEW_MAX_FILE_BYTES || String(150 * 1024 * 1024), 10);
const allowedVideoMimeTypes = new Set(['video/mp4']);
const MIME_EXTENSION_MAP = new Map([
    ['video/mp4', ['.mp4']],
]);
const upload = multer({
    dest: path.join(__dirname, '../uploads/'),
    limits: {
        fileSize: maxUploadSizeBytes,
    },
    fileFilter: (req, file, cb) => {
        if (allowedVideoMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported video format. Please upload an MP4 file.'));
    },
});

router.get('/test', (req, res) => res.send('Upload route is reachable on 5001'));

router.get('/private/:token', async (req, res) => {
    try {
        const { body, contentType, contentLength, cacheControl } = await resolveObjectFromSignedToken(req.params.token);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', cacheControl);
        if (contentLength) {
            res.setHeader('Content-Length', String(contentLength));
        }

        if (body && typeof body.pipe === 'function') {
            body.pipe(res);
            return;
        }

        const chunks = [];
        for await (const chunk of body) {
            chunks.push(chunk);
        }
        return res.send(Buffer.concat(chunks));
    } catch (error) {
        logger.security({
            event: 'private_upload_access_denied',
            message: error?.message || error,
            correlationId: req.correlationId,
        });
        return res.status(403).json({ message: 'Access denied' });
    }
});

const handleVideoUpload = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No video file provided" });

    const videoPath = req.file.path;
    const audioPath = path.join('uploads', `${req.file.filename}.mp3`);
    const correlationId = `v1-${String(req.user?._id || 'unknown')}-${Date.now()}`;
    logger.info({
        metric: 'v1_upload_count',
        value: 1,
        correlationId,
    });
    publishMetric({
        metricName: 'v1_upload_count',
        value: 1,
        role: 'system',
        correlationId,
    });
    publishMetric({
        metricName: 'InterviewDailyCount',
        value: 1,
        role: 'system',
        correlationId,
        dimensions: { UploadVersion: 'v1' },
    });

    try {
        const mimeType = String(req.file.mimetype || '').toLowerCase();
        if (!ensureExtensionMatchesMime(req.file.originalname, mimeType, MIME_EXTENSION_MAP)) {
            return res.status(400).json({ message: 'Invalid file extension' });
        }
        if (!isValidMp4Signature(videoPath)) {
            return res.status(400).json({ message: 'Invalid video content' });
        }
        await runVirusScanHook({
            filePath: videoPath,
            mimeType,
            originalName: req.file.originalname,
            correlationId,
        });

        // 0. Upload Video to S3 immediately
        logger.info({ event: 'v1_upload_to_s3_started', correlationId });
        const s3Url = await uploadToS3(videoPath, req.file.mimetype || 'video/mp4', { prefix: 'interview-videos' });
        logger.info({ event: 'v1_upload_to_s3_completed', correlationId });

        // 1. Extract Audio using FFmpeg (Stripping video for Gemini speed)
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(audioPath);
        });

        // 2. Process with Gemini 1.5 Flash
        const isEmployer = isRecruiter(req.user);
        const aiData = await extractWorkerDataFromAudio(audioPath, isEmployer ? 'employer' : 'worker', {
            userId: req.user?._id || null,
            rateLimitKey: String(req.user?._id || 'v1-upload'),
            region: req.user?.primaryRegion || req.user?.regionCode || null,
        });
        const rawData = Array.isArray(aiData) ? aiData[0] : aiData;

        const parseNumber = (value, fallback = 0) => {
            const normalized = Number.parseInt(String(value ?? '').replace(/[^0-9-]/g, ''), 10);
            return Number.isFinite(normalized) ? normalized : fallback;
        };

        const toSkills = (value) => {
            if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
            if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
            return [];
        };

        let savedProfile;
        let extractedData;
        let createdJob = null;

        if (isEmployer) {
            extractedData = {
                jobTitle: rawData?.jobTitle || rawData?.roleTitle || rawData?.roleName || null,
                companyName: rawData?.companyName || req.user.name || 'My Company',
                requiredSkills: toSkills(rawData?.requiredSkills || rawData?.skills),
                experienceRequired: rawData?.experienceRequired || null,
                salaryRange: rawData?.salaryRange || rawData?.expectedSalary || 'Negotiable',
                shift: rawData?.shift || rawData?.preferredShift || 'flexible',
                location: rawData?.location || rawData?.city || 'Remote',
                description: rawData?.description || 'New hiring requirement from Smart Interview.',
            };

            savedProfile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        companyName: extractedData.companyName || 'My Company',
                        location: extractedData.location || 'Remote',
                        industry: rawData?.industry || undefined,
                        videoIntroduction: {
                            videoUrl: s3Url,
                            transcript: 'Video processed by Gemini AI',
                        },
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            createdJob = await Job.create({
                employerId: req.user._id,
                title: extractedData.jobTitle || 'Open Position',
                companyName: extractedData.companyName || savedProfile.companyName || 'My Company',
                location: extractedData.location || savedProfile.location || 'Remote',
                salaryRange: extractedData.salaryRange || 'Negotiable',
                requirements: extractedData.requiredSkills,
                shift: String(extractedData.shift || 'flexible').toLowerCase() === 'day'
                    ? 'Day'
                    : String(extractedData.shift || 'flexible').toLowerCase() === 'night'
                        ? 'Night'
                        : 'Flexible',
                isPulse: String(req.body?.isPulse || '').toLowerCase() === 'true',
                isOpen: true,
            });
        } else {
            const fullName = String(rawData?.name || rawData?.firstName || req.user.name || '').trim();
            const [firstName = 'Unknown', ...rest] = fullName.split(' ').filter(Boolean);
            const lastName = rest.join(' ');

            extractedData = {
                name: fullName || `${firstName} ${lastName}`.trim(),
                roleTitle: rawData?.roleTitle || rawData?.roleName || null,
                skills: toSkills(rawData?.skills),
                experienceYears: Number.isFinite(rawData?.experienceYears) ? rawData.experienceYears : parseNumber(rawData?.totalExperience, null),
                expectedSalary: rawData?.expectedSalary || null,
                preferredShift: rawData?.preferredShift || 'flexible',
                location: rawData?.location || rawData?.city || null,
                summary: rawData?.summary || 'Profile generated from Smart Interview.',
            };

            savedProfile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        firstName,
                        lastName,
                        city: extractedData.location || 'Unknown',
                        totalExperience: Number.isFinite(extractedData.experienceYears) ? extractedData.experienceYears : 0,
                        videoIntroduction: {
                            videoUrl: s3Url,
                            transcript: 'Video processed by Gemini AI',
                        },
                        roleProfiles: [{
                            roleName: extractedData.roleTitle || 'General',
                            experienceInRole: Number.isFinite(extractedData.experienceYears) ? extractedData.experienceYears : 0,
                            expectedSalary: parseNumber(extractedData.expectedSalary, 0),
                            skills: extractedData.skills,
                            lastUpdated: new Date(),
                        }],
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }

        // 4. Update Onboarding Flag
        await User.findByIdAndUpdate(req.user._id, { hasCompletedProfile: true });

        // Cleanup files
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        // Video is now on S3, local not needed

        res.status(200).json({
            success: true,
            videoUrl: s3Url,
            extractedData,
            profile: savedProfile,
            job: createdJob,
        });

    } catch (error) {
        logger.warn({ event: 'v1_upload_pipeline_error', correlationId, message: error.message });
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        const statusCode = Number(error?.statusCode || 500);
        res.status(statusCode).json({ message: statusCode >= 500 ? 'Error processing video' : error.message });
    }
};

router.post('/video', protect, (req, res, next) => {
    upload.single('video')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Video too large' });
        }
        return res.status(400).json({ message: error.message || 'Invalid upload request' });
    });
}, handleVideoUpload);

module.exports = router;
module.exports.handleVideoUpload = handleVideoUpload;
