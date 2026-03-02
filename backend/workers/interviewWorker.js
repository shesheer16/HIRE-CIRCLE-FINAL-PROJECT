require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');

const connectDB = require('../config/db');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const Job = require('../models/Job');
const User = require('../models/userModel');
const Notification = require('../models/Notification');
const { extractWorkerDataFromAudio } = require('../services/geminiService');
const { sendPushNotificationForUser } = require('../services/pushService');
const {
    receiveInterviewMessages,
    deleteInterviewMessage,
    sendToInterviewDeadLetterQueue,
    getQueueSelfRecoveryConfig,
    isQueueConfigured,
    getInterviewQueueDepth,
} = require('../services/sqsInterviewQueue');
const {
    trackInterviewEvent,
    transitionProcessingStatus,
} = require('../services/interviewProcessingService');
const { publishMetric } = require('../services/metricsService');
const {
    fireAndForget,
    markFirstJobDraftCreatedOnce,
} = require('../services/revenueInstrumentationService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { recordQueueBacklog } = require('../services/systemMonitoringService');
const { isDegradationActive, setDegradationFlag } = require('../services/degradationService');
const { updateResilienceState } = require('../services/resilienceStateService');
const { EMPLOYER_PRIMARY_ROLE } = require('../utils/roleGuards');

ffmpeg.setFfmpegPath(ffmpegInstaller);

const workerConfig = {
    concurrency: Number.parseInt(process.env.INTERVIEW_WORKER_CONCURRENCY || '5', 10),
    pollWaitSeconds: Number.parseInt(process.env.INTERVIEW_WORKER_POLL_WAIT_SECONDS || '20', 10),
    visibilityTimeout: Number.parseInt(process.env.INTERVIEW_WORKER_VISIBILITY_TIMEOUT || '300', 10),
    staleMinutes: Number.parseInt(process.env.INTERVIEW_PROCESSING_STALE_MINUTES || '15', 10),
    processingTimeoutMs: Number.parseInt(process.env.INTERVIEW_PROCESSING_TIMEOUT_MS || String(5 * 60 * 1000), 10),
};
const queueRecoveryConfig = getQueueSelfRecoveryConfig();

let isShuttingDown = false;
let lastStaleRecoveryRun = 0;
const processingDurations = [];
let completionCount = 0;
let failureCount = 0;
const dlqEscalationCounter = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const parseNumber = (value, fallback = 0) => {
    const normalized = Number.parseInt(String(value ?? '').replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(normalized) ? normalized : fallback;
};

const toSkills = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
};

const extractDuration = async (videoPath) => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(videoPath, (error, metadata) => {
            if (error) {
                resolve(null);
                return;
            }
            const duration = Number(metadata?.format?.duration);
            resolve(Number.isFinite(duration) ? Math.round(duration) : null);
        });
    });
};

const extractAudio = async (videoPath, audioPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .toFormat('mp3')
            .on('end', resolve)
            .on('error', reject)
            .save(audioPath);
    });
};

const downloadVideo = async (videoUrl, destinationPath) => {
    const response = await axios.get(videoUrl, {
        responseType: 'stream',
        timeout: 60000,
    });

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destinationPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

const cleanupFile = (filePath) => {
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
};

const mapExtractionToProfileData = ({ rawData, role, userName }) => {
    if (role === EMPLOYER_PRIMARY_ROLE) {
        return {
            extractedData: {
                jobTitle: rawData?.jobTitle || rawData?.roleTitle || rawData?.roleName || null,
                companyName: rawData?.companyName || userName || 'My Company',
                requiredSkills: toSkills(rawData?.requiredSkills || rawData?.skills),
                experienceRequired: rawData?.experienceRequired || null,
                salaryRange: rawData?.salaryRange || rawData?.expectedSalary || 'Negotiable',
                shift: rawData?.shift || rawData?.preferredShift || 'flexible',
                location: rawData?.location || rawData?.city || 'Remote',
                description: rawData?.description || 'New hiring requirement from Smart Interview.',
                confidenceScore: Number.isFinite(rawData?.confidenceScore) ? rawData.confidenceScore : null,
            },
        };
    }

    const fullName = String(rawData?.name || rawData?.firstName || userName || '').trim();
    return {
        extractedData: {
            name: fullName || 'Unknown',
            roleTitle: rawData?.roleTitle || rawData?.roleName || null,
            skills: toSkills(rawData?.skills),
            experienceYears: Number.isFinite(rawData?.experienceYears) ? rawData.experienceYears : parseNumber(rawData?.totalExperience, null),
            expectedSalary: rawData?.expectedSalary || null,
            preferredShift: rawData?.preferredShift || 'flexible',
            location: rawData?.location || rawData?.city || null,
            summary: rawData?.summary || 'Profile generated from Smart Interview.',
            confidenceScore: Number.isFinite(rawData?.confidenceScore) ? rawData.confidenceScore : null,
        },
    };
};

const createDraftJobIfEmployer = async ({ userId, role, extractedData }) => {
    if (role !== EMPLOYER_PRIMARY_ROLE) return null;

    const createdJob = await Job.create({
        employerId: userId,
        title: extractedData.jobTitle || 'Open Position',
        companyName: extractedData.companyName || 'My Company',
        location: extractedData.location || 'Remote',
        salaryRange: extractedData.salaryRange || 'Negotiable',
        requirements: extractedData.requiredSkills || [],
        shift: String(extractedData.shift || 'flexible').toLowerCase() === 'day'
            ? 'Day'
            : String(extractedData.shift || 'flexible').toLowerCase() === 'night'
                ? 'Night'
                : 'Flexible',
        isPulse: false,
        isOpen: false,
        status: 'draft_from_ai',
    });

    return createdJob._id;
};

const computeTranscriptWordCount = (extractedData) => {
    const searchable = [
        extractedData?.summary,
        extractedData?.description,
        Array.isArray(extractedData?.skills) ? extractedData.skills.join(' ') : '',
        Array.isArray(extractedData?.requiredSkills) ? extractedData.requiredSkills.join(' ') : '',
    ]
        .filter(Boolean)
        .join(' ')
        .trim();

    if (!searchable) return 0;
    return searchable.split(/\s+/).filter(Boolean).length;
};

const computeP95 = (values = []) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[index];
};

const withTimeout = (promiseFactory, timeoutMs, timeoutMessage = 'Interview processing timed out') => {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    return Promise.race([promiseFactory(), timeoutPromise])
        .finally(() => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        });
};

const notifyInterviewReady = async ({ userId, processingId, correlationId }) => {
    const lock = await InterviewProcessingJob.updateOne(
        { _id: processingId, status: 'completed', notificationSentAt: null },
        { $set: { notificationSentAt: new Date() } }
    );

    if (!lock.modifiedCount) {
        console.log(JSON.stringify({
            event: 'interview_ready_notification_skipped',
            correlationId,
            reason: 'already_sent',
        }));
        return;
    }

    const user = await User.findById(userId).select('pushTokens notificationPreferences');
    await Notification.create({
        user: userId,
        type: 'interview_ready',
        title: 'Smart Interview Ready',
        message: 'Your interview analysis is ready. Review and confirm your profile.',
        relatedData: {
            processingId,
        },
    });

    await sendPushNotificationForUser(
        user,
        'Smart Interview Ready',
        'Your interview is processed. Tap to review.',
        {
            type: 'INTERVIEW_READY',
            processingId: String(processingId),
        },
        'interview_ready'
    );

    console.log(JSON.stringify({
        event: 'interview_ready_notification_sent',
        correlationId,
        userId: String(userId),
    }));
};

const handleRetryLimitExceeded = async ({
    message,
    correlationId,
    processingId,
    role,
    reason = 'max_receive_count_exceeded',
}) => {
    await sendToInterviewDeadLetterQueue({
        payload: {
            processingId,
            body: message?.Body || null,
        },
        reason,
        originalMessage: message,
    });

    if (processingId) {
        await InterviewProcessingJob.findByIdAndUpdate(processingId, {
            $set: {
                status: 'failed',
                errorMessage: `Moved to DLQ: ${reason}`,
                completedAt: new Date(),
            },
        });
    }

    await publishMetric({
        metricName: 'InterviewFailureCount',
        value: 1,
        role: role || 'system',
        correlationId,
        dimensions: { Reason: 'DeadLetterQueue' },
    });

    console.warn(JSON.stringify({
        event: 'interview_dlq_moved',
        correlationId,
        receiveCount: Number(message?.Attributes?.ApproximateReceiveCount || 0),
        reason,
    }));

    await deleteInterviewMessage(message?.ReceiptHandle);
};

const processQueueMessage = async (message) => {
    const startedAt = Date.now();
    let parsedBody = null;

    try {
        parsedBody = JSON.parse(message.Body || '{}');
    } catch (error) {
        console.warn(JSON.stringify({
            event: 'interview_worker_invalid_message',
            correlationId: 'unknown',
            message: error.message,
        }));
        await deleteInterviewMessage(message.ReceiptHandle);
        return;
    }

    const { processingId, userId, role, videoUrl } = parsedBody;
    const correlationId = String(processingId || 'unknown');
    const receiveCount = Number.parseInt(message?.Attributes?.ApproximateReceiveCount || '1', 10) || 1;
    if (receiveCount >= Number(queueRecoveryConfig.maxReceiveCount || 5)) {
        await handleRetryLimitExceeded({
            message,
            correlationId,
            processingId,
            role,
        });
        return;
    }
    if (receiveCount >= 4) {
        const currentEscalationCount = (dlqEscalationCounter.get(correlationId) || 0) + 1;
        dlqEscalationCounter.set(correlationId, currentEscalationCount);
        if (currentEscalationCount >= 2) {
            console.warn(JSON.stringify({
                event: 'interview_dlq_escalation',
                severity: 'critical',
                correlationId,
                receiveCount,
            }));
            await publishMetric({
                metricName: 'InterviewFailureCount',
                value: 1,
                role,
                correlationId,
                dimensions: { Reason: 'DLQEscalation' },
            });
        }
    }
    if (!processingId || !userId || !videoUrl) {
        console.warn(JSON.stringify({
            event: 'interview_worker_message_missing_fields',
            correlationId,
        }));
        await deleteInterviewMessage(message.ReceiptHandle);
        return;
    }

    const existingJob = await InterviewProcessingJob.findById(processingId).select('status');
    if (!existingJob) {
        console.warn(JSON.stringify({
            event: 'interview_worker_job_missing',
            correlationId,
        }));
        await deleteInterviewMessage(message.ReceiptHandle);
        return;
    }

    if (existingJob.status === 'completed') {
        console.log(JSON.stringify({
            event: 'interview_worker_skip_completed',
            correlationId,
        }));
        await deleteInterviewMessage(message.ReceiptHandle);
        return;
    }

    if (existingJob.status === 'failed') {
        await transitionProcessingStatus({
            processingId,
            fromStatus: 'failed',
            toStatus: 'pending',
            set: {
                status: 'pending',
                errorMessage: null,
                completedAt: null,
            },
        });
    }

    const claimResult = await transitionProcessingStatus({
        processingId,
        fromStatus: 'pending',
        toStatus: 'processing',
        set: {
            status: 'processing',
            startedAt: new Date(),
            errorMessage: null,
        },
    });

    if (!claimResult.modifiedCount) {
        console.log(JSON.stringify({
            event: 'interview_worker_claim_skipped',
            correlationId,
            currentStatus: existingJob.status,
        }));
        return;
    }

    await trackInterviewEvent({
        userId,
        eventName: 'INTERVIEW_PROCESSING_STARTED',
        processingId,
        role,
        durationMs: 0,
    });

    const tmpBase = path.join(os.tmpdir(), `interview-${processingId}-${Date.now()}`);
    const videoPath = `${tmpBase}.mp4`;
    const audioPath = `${tmpBase}.mp3`;

    try {
        const {
            mapped,
            createdJobId,
            videoDuration,
            transcriptWordCount,
            confidenceScore,
        } = await withTimeout(async () => {
            await downloadVideo(videoUrl, videoPath);
            const videoDurationResolved = await extractDuration(videoPath);
            await extractAudio(videoPath, audioPath);
            const aiData = await extractWorkerDataFromAudio(audioPath, role, {
                userId,
                interviewProcessingId: processingId,
                rateLimitKey: String(userId || processingId || 'interview-worker'),
                region: null,
            });
            const rawData = Array.isArray(aiData) ? aiData[0] : aiData;

            const user = await User.findById(userId).select('name');
            const mappedData = mapExtractionToProfileData({
                rawData,
                role,
                userName: user?.name || '',
            });

            const draftJobId = await createDraftJobIfEmployer({
                userId,
                role,
                extractedData: mappedData.extractedData,
            });
            if (draftJobId) {
                console.log(JSON.stringify({
                    event: 'draft_job_created',
                    metric: 'draft_job_created',
                    correlationId,
                    jobId: String(draftJobId),
                }));
                fireAndForget('markFirstJobDraftCreatedOnce', () => markFirstJobDraftCreatedOnce({
                    employerId: userId,
                    jobId: draftJobId,
                    city: mappedData?.extractedData?.location || null,
                    roleCluster: mappedData?.extractedData?.jobTitle || null,
                }), { correlationId, userId: String(userId), jobId: String(draftJobId) });
            }

            const transcriptWordCountResolved = computeTranscriptWordCount(mappedData.extractedData);
            const confidenceScoreResolved = Number.isFinite(mappedData.extractedData?.confidenceScore)
                ? Number(mappedData.extractedData.confidenceScore)
                : null;

            return {
                mapped: mappedData,
                createdJobId: draftJobId,
                videoDuration: videoDurationResolved,
                transcriptWordCount: transcriptWordCountResolved,
                confidenceScore: confidenceScoreResolved,
            };
        }, workerConfig.processingTimeoutMs, 'Interview processing timed out after 5 minutes');

        const completionResult = await transitionProcessingStatus({
            processingId,
            fromStatus: 'processing',
            toStatus: 'completed',
            set: {
                status: 'completed',
                extractedData: mapped.extractedData,
                createdJobId: createdJobId || null,
                completedAt: new Date(),
                rawMetrics: {
                    videoDuration,
                    transcriptWordCount,
                    confidenceScore,
                },
            },
        });

        if (!completionResult.modifiedCount) {
            console.warn(JSON.stringify({
                event: 'interview_worker_completion_transition_rejected',
                correlationId,
            }));
            return;
        }

        await notifyInterviewReady({ userId, processingId, correlationId });

        await trackInterviewEvent({
            userId,
            eventName: 'INTERVIEW_PROCESSING_COMPLETED',
            processingId,
            role,
            durationMs: Date.now() - startedAt,
        });
        safeLogPlatformEvent({
            type: 'interview_complete',
            userId,
            meta: {
                processingId: String(processingId),
                role,
                durationMs: Date.now() - startedAt,
            },
        });

        const durationMs = Date.now() - startedAt;
        processingDurations.push(durationMs);
        if (processingDurations.length > 200) processingDurations.shift();
        completionCount += 1;
        console.log(JSON.stringify({
            metric: 'processing_time_p95',
            value: computeP95(processingDurations),
            sampleSize: processingDurations.length,
            correlationId,
        }));
        await publishMetric({
            metricName: 'InterviewProcessingTimeMs',
            value: durationMs,
            unit: 'Milliseconds',
            role,
            correlationId,
        });
        console.log(JSON.stringify({
            metric: 'confirm_completion_rate',
            value: completionCount / Math.max(1, completionCount + failureCount),
            correlationId,
        }));
        await publishMetric({
            metricName: 'ConfirmCompletionRate',
            value: completionCount / Math.max(1, completionCount + failureCount),
            role,
            correlationId,
        });

        await deleteInterviewMessage(message.ReceiptHandle);
    } catch (error) {
        console.warn(JSON.stringify({
            event: 'interview_worker_error',
            correlationId,
            message: error.message,
        }));
        await transitionProcessingStatus({
            processingId,
            fromStatus: 'processing',
            toStatus: 'failed',
            set: {
                status: 'failed',
                errorMessage: error.message || 'Interview processing failed',
                completedAt: new Date(),
            },
        });

        await trackInterviewEvent({
            userId,
            eventName: 'INTERVIEW_PROCESSING_FAILED',
            processingId,
            role,
            durationMs: Date.now() - startedAt,
            errorType: error.name || 'processing_error',
        });
        failureCount += 1;
        const timeoutTriggered = String(error?.message || '').toLowerCase().includes('timed out');
        await publishMetric({
            metricName: timeoutTriggered ? 'InterviewTimeoutCount' : 'InterviewFailureCount',
            value: 1,
            role,
            correlationId,
            dimensions: { Reason: timeoutTriggered ? 'ProcessingTimeout' : 'ProcessingError' },
        });
        console.log(JSON.stringify({
            metric: 'failure_rate',
            value: failureCount / Math.max(1, completionCount + failureCount),
            correlationId,
        }));
    } finally {
        cleanupFile(videoPath);
        cleanupFile(audioPath);
    }
};

const recoverStaleJobsIfNeeded = async () => {
    const now = Date.now();
    if (now - lastStaleRecoveryRun < 60_000) return;
    lastStaleRecoveryRun = now;

    const staleThreshold = new Date(now - workerConfig.staleMinutes * 60 * 1000);
    const result = await InterviewProcessingJob.updateMany(
        {
            status: 'processing',
            startedAt: { $lt: staleThreshold },
        },
        {
            $set: {
                status: 'pending',
                startedAt: null,
                errorMessage: 'Recovered stale processing job.',
            },
        }
    );

    if (result.modifiedCount > 0) {
        console.log(JSON.stringify({
            event: 'interview_worker_recovered_stale_jobs',
            metric: 'recovered_stale_jobs',
            value: result.modifiedCount,
            correlationId: 'stale-recovery',
        }));
    }
};

const runLoop = async () => {
    console.log('Interview worker started.');

    while (!isShuttingDown) {
        try {
            if (isDegradationActive('queuePaused')) {
                await sleep(1000);
                continue;
            }

            await recoverStaleJobsIfNeeded();
            const queueDepth = await getInterviewQueueDepth();
            updateResilienceState({
                queueDepth,
                queueBackpressureActive: queueDepth >= Number.parseInt(process.env.QUEUE_BACKPRESSURE_DEPTH || '1500', 10),
            });
            await recordQueueBacklog({ queueDepth });

            if (queueDepth >= Number.parseInt(process.env.QUEUE_BACKPRESSURE_DEPTH || '1500', 10)) {
                setDegradationFlag('smartInterviewPaused', true, 'queue_backpressure');
                setDegradationFlag('heavyAnalyticsPaused', true, 'queue_backpressure');
            } else if (!isDegradationActive('queuePaused')) {
                setDegradationFlag('smartInterviewPaused', false, null);
                setDegradationFlag('heavyAnalyticsPaused', false, null);
            }

            await publishMetric({
                metricName: 'InterviewQueueDepth',
                value: queueDepth,
                role: 'system',
                correlationId: 'worker-loop',
            });
            const messages = await receiveInterviewMessages(
                workerConfig.concurrency,
                workerConfig.pollWaitSeconds,
                workerConfig.visibilityTimeout
            );

            if (!messages.length) continue;
            await Promise.all(messages.map((message) => processQueueMessage(message)));
        } catch (error) {
            console.warn('Interview worker loop error:', error.message);
        }
    }

    console.log('Interview worker stopped.');
};

const bootstrap = async () => {
    await connectDB();

    if (!isQueueConfigured()) {
        console.warn('Interview worker cannot start: queue is not configured.');
        process.exit(1);
    }

    await runLoop();
};

process.on('SIGTERM', () => {
    isShuttingDown = true;
});

process.on('SIGINT', () => {
    isShuttingDown = true;
});

bootstrap().catch((error) => {
    console.warn('Interview worker bootstrap failed:', error.message);
    process.exit(1);
});
