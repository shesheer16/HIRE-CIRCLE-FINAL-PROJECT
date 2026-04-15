const express = require('express');
const router = express.Router();
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegInstaller);
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { extractWorkerDataFromAudio } = require('../services/geminiService');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const User = require('../models/userModel');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const { protect } = require('../middleware/authMiddleware');
const { resolveStoredObjectFromSignedToken } = require('../services/localStorageService');
const { publishMetric } = require('../services/metricsService');
const { isRecruiter } = require('../utils/roleGuards');
const logger = require('../utils/logger');
const { ensureExtensionMatchesMime, isValidMp4Signature, runVirusScanHook } = require('../services/uploadSecurityService');
const { appendSmartInterviewTraceSyncSafe } = require('../services/smartInterviewTraceService');

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
        const { body, contentType, contentLength, cacheControl, absolutePath } = await resolveStoredObjectFromSignedToken(req.params.token);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', cacheControl);
        res.setHeader('Accept-Ranges', 'bytes');

        const totalLength = Number(contentLength || 0);
        const rangeHeader = String(req.headers?.range || '').trim();

        if (rangeHeader && absolutePath && totalLength > 0 && fs.existsSync(absolutePath)) {
            if (typeof body?.destroy === 'function') {
                body.destroy();
            }

            const match = rangeHeader.match(/bytes=(\d*)-(\d*)/i);
            if (!match) {
                res.status(416);
                res.setHeader('Content-Range', `bytes */${totalLength}`);
                return res.end();
            }

            let start = Number.parseInt(match[1], 10);
            let end = Number.parseInt(match[2], 10);

            if (match[1] === '' && match[2] !== '') {
                const suffixLength = Number.parseInt(match[2], 10);
                if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
                    res.status(416);
                    res.setHeader('Content-Range', `bytes */${totalLength}`);
                    return res.end();
                }
                start = Math.max(totalLength - suffixLength, 0);
                end = totalLength - 1;
            } else {
                if (!Number.isFinite(start) || start < 0) start = 0;
                if (!Number.isFinite(end) || end < start) end = totalLength - 1;
                end = Math.min(end, totalLength - 1);
            }

            if (start >= totalLength || end < start) {
                res.status(416);
                res.setHeader('Content-Range', `bytes */${totalLength}`);
                return res.end();
            }

            const chunkSize = (end - start) + 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
            res.setHeader('Content-Length', String(chunkSize));

            const rangedBody = fs.createReadStream(absolutePath, { start, end });
            rangedBody.on('error', (streamError) => {
                logger.security({
                    event: 'private_upload_range_stream_error',
                    message: streamError?.message || streamError,
                    correlationId: req.correlationId,
                });
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Unable to stream media' });
                } else {
                    res.end();
                }
            });
            rangedBody.pipe(res);
            return;
        }

        if (totalLength) {
            res.setHeader('Content-Length', String(contentLength));
        }

        if (body && typeof body.pipe === 'function') {
            body.on('error', (streamError) => {
                logger.security({
                    event: 'private_upload_stream_error',
                    message: streamError?.message || streamError,
                    correlationId: req.correlationId,
                });
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Unable to stream media' });
                } else {
                    res.end();
                }
            });
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
    if (!req.file) return res.status(400).json({ message: 'No video file provided' });

    const videoPath = req.file.path;
    const audioPath = path.join('uploads', `${req.file.filename}.mp3`);
    const correlationId = `v1-${String(req.user?._id || 'unknown')}-${Date.now()}`;
    const trace = (phase, data = {}) => {
        appendSmartInterviewTraceSyncSafe({
            traceId: correlationId,
            phase,
            data,
        });
    };
    const uploadRequestSnapshot = {
        authPassed: true,
        filePath: videoPath,
        fileExists: fs.existsSync(videoPath),
        fileSizeBytes: Number(req.file.size || 0),
        originalName: req.file.originalname,
        mimeType: String(req.file.mimetype || '').toLowerCase(),
        userId: String(req.user?._id || ''),
        interviewId: correlationId,
    };
    const isV2UploadRequest = String(req.originalUrl || '').includes('/api/v2/upload/video');
    let processingJob = null;
    logger.info({
        event: 'smart_interview_upload_received',
        ...uploadRequestSnapshot,
    });
    trace('upload_route_received', uploadRequestSnapshot);
    const cleanupFiles = () => {
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    };

    const parseNumber = (value, fallback = 0) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        const normalizedInput = String(value ?? '').replace(/,/g, '').trim().toLowerCase();
        if (!normalizedInput) return fallback;
        const token = normalizedInput.match(/(-?\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|crore|cr)?/i);
        if (!token) return fallback;
        const base = Number.parseFloat(token[1]);
        if (!Number.isFinite(base)) return fallback;
        const multiplierBySuffix = {
            k: 1000,
            thousand: 1000,
            lakh: 100000,
            lac: 100000,
            crore: 10000000,
            cr: 10000000,
        };
        const suffix = String(token[2] || '').toLowerCase();
        const multiplier = multiplierBySuffix[suffix] || 1;
        return Math.max(0, base * multiplier);
    };

    const toSkills = (value) => {
        const source = Array.isArray(value)
            ? value
            : (typeof value === 'string' ? value.split(',') : []);
        const seen = new Set();
        return source
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .filter((item) => {
                const key = item.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    };

    const pickString = (...values) => {
        for (const value of values) {
            const normalized = String(value ?? '').trim();
            if (normalized) return normalized;
        }
        return '';
    };

    const normalizeShift = (value, fallback = 'flexible') => {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) return fallback;
        if (normalized.includes('day')) return 'day';
        if (normalized.includes('night')) return 'night';
        return 'flexible';
    };

    const formatCurrency = (value) => {
        const numeric = Math.max(0, Math.round(parseNumber(value, 0)));
        if (numeric <= 0) return '';
        return `₹${numeric.toLocaleString('en-IN')}`;
    };

    const createValidationError = (issues = [], extracted = {}) => {
        const error = new Error('Smart Interview extraction is incomplete. Please clearly mention role, city, experience, expected salary, and skills.');
        error.statusCode = 422;
        error.payload = {
            success: false,
            error: error.message,
            validationIssues: issues,
            extractedData: extracted,
        };
        return error;
    };

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
        if (isV2UploadRequest) {
            const role = isRecruiter(req.user) ? 'employer' : 'worker';
            const videoHash = crypto
                .createHash('sha256')
                .update(`${String(req.user?._id || '')}:${req.file.filename}:${req.file.size}:${Date.now()}`)
                .digest('hex');
            const idempotencyKey = crypto
                .createHash('sha256')
                .update(`${String(req.user?._id || '')}:${videoHash}:${Date.now()}`)
                .digest('hex');
            processingJob = await InterviewProcessingJob.create({
                userId: req.user._id,
                role,
                videoUrl: `local://inline/${req.file.filename}`,
                videoHash,
                idempotencyKey,
                status: 'processing',
                startedAt: new Date(),
            });
            trace('processing_job_created', {
                processingId: String(processingJob._id),
                status: 'processing',
            });
        }
        trace('pipeline_start', {
            userId: String(req.user?._id || ''),
            role: isRecruiter(req.user) ? 'employer' : 'worker',
            originalName: req.file.originalname,
            mimeType,
            sizeBytes: Number(req.file.size || 0),
        });
        trace('request_received', {
            originalName: req.file.originalname,
            mimeType,
            sizeBytes: Number(req.file.size || 0),
            userId: String(req.user?._id || ''),
        });

        if (!ensureExtensionMatchesMime(req.file.originalname, mimeType, MIME_EXTENSION_MAP)) {
            throw Object.assign(new Error('Invalid file extension'), { statusCode: 400 });
        }
        if (!isValidMp4Signature(videoPath)) {
            throw Object.assign(new Error('Invalid video content'), { statusCode: 400 });
        }
        await runVirusScanHook({
            filePath: videoPath,
            mimeType,
            originalName: req.file.originalname,
            correlationId,
        });

        logger.info({ event: 'v1_upload_local_processing_started', correlationId });
        trace('video_storage_precheck', {
            filePath: videoPath,
            fileExists: fs.existsSync(videoPath),
            fileSizeBytes: Number(req.file.size || 0),
        });
        const localVideoPath = videoPath;
        logger.info({ event: 'v1_upload_local_processing_ready', correlationId });
        trace('video_stored_local', { localPath: localVideoPath });

        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(audioPath);
        });
        const audioStat = fs.statSync(audioPath);
        trace('audio_conversion', {
            audioPath,
            mimeType: 'audio/mpeg',
            sizeBytes: Number(audioStat?.size || 0),
        });

        const isEmployer = isRecruiter(req.user);
        const aiData = await extractWorkerDataFromAudio(audioPath, isEmployer ? 'employer' : 'worker', {
            userId: req.user?._id || null,
            rateLimitKey: String(req.user?._id || 'v1-upload'),
            region: req.user?.primaryRegion || req.user?.regionCode || null,
            correlationId,
            traceId: correlationId,
        });
        const rawData = Array.isArray(aiData) ? aiData[0] : aiData;
        const transcript = String(rawData?.transcript || '').trim();
        trace('transcript_received', {
            transcript,
            transcriptLength: transcript.length,
        });
        trace('gemini_structured_output', {
            rawTranscript: transcript,
            parsedStructuredObject: rawData,
        });

        const resolvedRoleName = pickString(rawData?.roleName, rawData?.jobTitle, rawData?.roleTitle);
        const resolvedLocation = pickString(rawData?.city, rawData?.location);
        const resolvedSkills = toSkills(rawData?.skills || rawData?.requiredSkills);
        const resolvedExperienceYears = Math.max(0, Math.round(parseNumber(
            rawData?.totalExperience ?? rawData?.experienceRequired,
            0
        )));
        const resolvedExpectedSalary = Math.max(0, Math.round(parseNumber(
            rawData?.expectedSalary ?? rawData?.salaryRange,
            0
        )));

        const validationIssues = [];
        if (!resolvedRoleName) validationIssues.push({ field: 'roleName', reason: 'missing_or_empty' });
        if (!resolvedLocation) validationIssues.push({ field: 'city', reason: 'missing_or_empty' });
        if (!resolvedSkills.length) validationIssues.push({ field: 'skills', reason: 'missing_or_empty' });
        if (!(resolvedExperienceYears > 0)) validationIssues.push({ field: 'totalExperience', reason: 'must_be_positive_number' });
        if (!(resolvedExpectedSalary > 0)) validationIssues.push({ field: 'expectedSalary', reason: 'must_be_positive_number' });
        if (!transcript) validationIssues.push({ field: 'transcript', reason: 'empty_transcript' });

        trace('validation_layer', {
            normalizedExtraction: {
                roleName: resolvedRoleName,
                city: resolvedLocation,
                skills: resolvedSkills,
                totalExperience: resolvedExperienceYears,
                expectedSalary: resolvedExpectedSalary,
            },
            validationIssues,
        });

        if (validationIssues.length) {
            throw createValidationError(validationIssues, {
                roleName: resolvedRoleName,
                city: resolvedLocation,
                skills: resolvedSkills,
                totalExperience: resolvedExperienceYears,
                expectedSalary: resolvedExpectedSalary,
            });
        }
        trace('validation_passed', {
            roleName: resolvedRoleName,
            city: resolvedLocation,
            skillsCount: resolvedSkills.length,
            totalExperience: resolvedExperienceYears,
            expectedSalary: resolvedExpectedSalary,
        });

        let savedProfile;
        let extractedData;
        let createdJob = null;
        let manualFallbackRequired = Boolean(rawData?.manualFallbackRequired);

        if (isEmployer) {
            const existingEmployerProfile = await EmployerProfile.findOne({ user: req.user._id }).lean();
            const companyName = pickString(rawData?.companyName, existingEmployerProfile?.companyName, req.user?.name);
            if (!companyName) {
                throw createValidationError(
                    [{ field: 'companyName', reason: 'missing_profile_company_name' }],
                    { roleName: resolvedRoleName, city: resolvedLocation, skills: resolvedSkills, expectedSalary: resolvedExpectedSalary }
                );
            }

            extractedData = {
                jobTitle: resolvedRoleName,
                companyName,
                requiredSkills: resolvedSkills,
                experienceRequired: `${resolvedExperienceYears} years`,
                salaryRange: formatCurrency(resolvedExpectedSalary),
                shift: normalizeShift(rawData?.shift || rawData?.preferredShift, 'flexible'),
                location: resolvedLocation,
                description: String(rawData?.description || '').trim(),
            };
            trace('profile_builder', {
                role: 'employer',
                extractedData,
            });

            savedProfile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        companyName: extractedData.companyName,
                        location: extractedData.location,
                        industry: extractedData.jobTitle,
                        videoIntroduction: {
                            videoUrl: null,
                            transcript,
                            rawExtraction: rawData,
                        },
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            createdJob = await Job.create({
                employerId: req.user._id,
                title: extractedData.jobTitle,
                companyName: extractedData.companyName,
                location: extractedData.location,
                salaryRange: extractedData.salaryRange,
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
            const fullNameSource = pickString(rawData?.firstName, req.user?.name);
            const [firstName = '', ...rest] = fullNameSource.split(' ').filter(Boolean);
            const lastName = rest.join(' ');
            if (!firstName) {
                throw createValidationError(
                    [{ field: 'firstName', reason: 'missing_or_empty' }],
                    { roleName: resolvedRoleName, city: resolvedLocation, skills: resolvedSkills, expectedSalary: resolvedExpectedSalary }
                );
            }

            extractedData = {
                name: [firstName, lastName].filter(Boolean).join(' ').trim(),
                roleTitle: resolvedRoleName,
                skills: resolvedSkills,
                experienceYears: resolvedExperienceYears,
                expectedSalary: formatCurrency(resolvedExpectedSalary),
                preferredShift: normalizeShift(rawData?.preferredShift, 'flexible'),
                location: resolvedLocation,
                summary: String(rawData?.summary || '').trim(),
            };
            trace('profile_builder', {
                role: 'worker',
                extractedData,
            });

            savedProfile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        firstName,
                        lastName,
                        city: extractedData.location,
                        totalExperience: extractedData.experienceYears,
                        videoIntroduction: {
                            videoUrl: null,
                            transcript,
                            rawExtraction: rawData,
                        },
                        roleProfiles: [{
                            roleName: extractedData.roleTitle,
                            experienceInRole: extractedData.experienceYears,
                            expectedSalary: resolvedExpectedSalary,
                            skills: extractedData.skills,
                            lastUpdated: new Date(),
                        }],
                        interviewVerified: true,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }

        await User.findByIdAndUpdate(req.user._id, {
            hasCompletedProfile: true,
            profileComplete: true,
            hasSelectedRole: true,
        });
        if (processingJob?._id) {
            await InterviewProcessingJob.findByIdAndUpdate(processingJob._id, {
                $set: {
                    status: 'completed',
                    extractedData,
                    createdJobId: createdJob?._id || null,
                    completedAt: new Date(),
                    errorMessage: null,
                },
            });
            trace('status_updated', {
                processingId: String(processingJob._id),
                status: 'completed',
            });
        }

        trace('db_write', {
            profileId: String(savedProfile?._id || ''),
            jobId: String(createdJob?._id || ''),
            finalSavedProfileDocument: savedProfile ? {
                _id: savedProfile._id,
                firstName: savedProfile.firstName,
                city: savedProfile.city || savedProfile.location,
                roleProfiles: savedProfile.roleProfiles,
                companyName: savedProfile.companyName,
                industry: savedProfile.industry,
            } : null,
        });
        trace('profile_saved', {
            profileId: String(savedProfile?._id || ''),
            jobId: String(createdJob?._id || ''),
        });

        const responsePayload = {
            success: true,
            videoUrl: null,
            processingId: processingJob?._id || null,
            status: processingJob?._id ? 'PROCESSING' : 'COMPLETED',
            extractedData,
            profile: savedProfile,
            job: createdJob,
            manualFallbackRequired,
            validationIssues: [],
        };
        console.log('FINAL_PROFILE_SAVED:', savedProfile);
        console.log('STATUS_SET_TO_COMPLETED');
        trace('response_sent', responsePayload);
        return res.status(200).json(responsePayload);
    } catch (error) {
        logger.warn({ event: 'v1_upload_pipeline_error', correlationId, message: error.message });
        if (processingJob?._id) {
            await InterviewProcessingJob.findByIdAndUpdate(processingJob._id, {
                $set: {
                    status: 'failed',
                    errorMessage: String(error?.message || 'Interview processing failed'),
                    completedAt: new Date(),
                },
            }).catch(() => null);
            trace('status_updated', {
                processingId: String(processingJob._id),
                status: 'failed',
            });
        }
        trace('pipeline_error', {
            message: String(error?.message || ''),
            statusCode: Number(error?.statusCode || 500),
            code: String(error?.code || ''),
            details: error?.payload || null,
        });
        const statusCode = Number(error?.statusCode || 500);
        const errorCode = String(error?.code || 'SMART_INTERVIEW_PIPELINE_ERROR');
        const shouldRedactMessage = statusCode >= 500
            && String(process.env.NODE_ENV || '').toLowerCase() === 'production';
        const message = shouldRedactMessage
            ? 'Error processing video'
            : String(error?.message || 'Error processing video');
        const payload = error?.payload || {
            success: false,
            error: message,
            message,
            errorCode,
        };
        return res.status(statusCode).json(payload);
    } finally {
        cleanupFiles();
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
