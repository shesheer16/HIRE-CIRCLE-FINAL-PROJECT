const Application = require('../models/Application');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const User = require('../models/userModel');
const { createNotification } = require('./notificationController');
const { sendPushNotificationForUser } = require('../services/pushService');
const {
    fireAndForget,
    markFirstShortlistOnce,
    markFirstHireOnce,
    recordLifecycleEvent,
    normalizeSalaryBand,
} = require('../services/revenueInstrumentationService');
const {
    recordMatchPerformanceMetric,
    recordJobFillCompletedOnce,
} = require('../services/matchMetricsService');
const { recordMatchSnapshotForHire } = require('../services/matchSnapshotService');
const { evaluateReferralEligibility } = require('../services/referralService');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { createAndSendBehaviorNotification } = require('../services/growthNotificationService');
const { recomputeUserNetworkScore } = require('../services/networkScoreService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { hasFeatureAccess, FEATURES } = require('../services/subscriptionService');
const { ensureHireRecordFromApplication } = require('../services/hireRecordService');
const { ensureFeedbackSlotForHire } = require('../services/matchFeedbackLoopService');
const { applyReferralHireBoost } = require('../services/referralGraphService');
const {
    registerHireGraphRelations,
    recomputeTrustGraphForUser,
} = require('../services/trustGraphService');
const { computeBadgeForUser } = require('../services/verificationBadgeService');
const { recomputeSkillReputationForUser } = require('../services/skillReputationService');
const { runNetworkEffectLoopsForUser } = require('../services/networkEffectEngineService');
const {
    evaluateWorkerProfileCompletion,
    isActionAllowedByProfileCompletion,
} = require('../services/profileCompletionService');
const { isRecruiter } = require('../utils/roleGuards');
const { normalizeApplicationStatus } = require('../workflow/applicationStateMachine');
const { transitionApplicationStatus } = require('../services/applicationWorkflowService');
const { queueWebhookEvent } = require('../services/platformWebhookService');

const EMPLOYER_ALLOWED_TARGETS = new Set([
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'rejected',
    'hired',
]);

const WORKER_ALLOWED_TARGETS = new Set([
    'withdrawn',
    'offer_accepted',
    'offer_declined',
]);

// @desc    Send Connection Request (Worker applies OR Employer invites)
// @route   POST /api/applications
// @access  Private
const sendRequest = async (req, res) => {
    const { jobId, workerId, initiatedBy } = req.body;

    try {
        // 1. Validation
        if (!jobId || !workerId || !initiatedBy) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ message: 'Job not found' });
        if (job.isDisabled) {
            return res.status(403).json({ message: 'Job is disabled by admin' });
        }

        // workerId from mobile can be either WorkerProfile._id or User._id.
        let resolvedWorkerProfile = await WorkerProfile.findById(workerId).select(
            '_id user firstName city avatar roleProfiles totalExperience isAvailable availabilityWindowDays openToRelocation openToNightShift interviewVerified'
        );
        if (!resolvedWorkerProfile) {
            resolvedWorkerProfile = await WorkerProfile.findOne({ user: workerId }).select(
                '_id user firstName city avatar roleProfiles totalExperience isAvailable availabilityWindowDays openToRelocation openToNightShift interviewVerified'
            );
        }
        if (!resolvedWorkerProfile) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        const normalizedInitiatedBy = String(initiatedBy || '').trim().toLowerCase();
        if (!['worker', 'employer'].includes(normalizedInitiatedBy)) {
            return res.status(400).json({ message: 'Invalid initiatedBy value' });
        }

        if (normalizedInitiatedBy === 'worker') {
            if (String(resolvedWorkerProfile.user) !== String(req.user?._id || '')) {
                return res.status(403).json({ message: 'Worker can only apply for self' });
            }

            const workerUser = await User.findById(resolvedWorkerProfile.user)
                .select('name city isVerified hasCompletedProfile activeRole primaryRole role isDeleted')
                .lean();
            if (!workerUser || workerUser.isDeleted) {
                return res.status(404).json({ message: 'Worker account not found' });
            }

            const completion = evaluateWorkerProfileCompletion({
                user: workerUser,
                workerProfile: resolvedWorkerProfile.toObject ? resolvedWorkerProfile.toObject() : resolvedWorkerProfile,
            });
            const gate = isActionAllowedByProfileCompletion({
                action: 'apply',
                completion,
            });

            if (!gate.allowed) {
                return res.status(403).json({
                    message: `Complete your profile to at least ${gate.threshold}% before applying.`,
                    code: gate.code,
                    completion,
                    missingRequiredFields: gate.missingRequiredFields,
                });
            }
        } else {
            if (!isRecruiter(req.user)) {
                return res.status(403).json({ message: 'Only employers can invite workers' });
            }
            if (String(job.employerId) !== String(req.user?._id || '')) {
                return res.status(403).json({ message: 'Not authorized to invite for this job' });
            }
        }

        const hasUnlimitedApplications = await hasFeatureAccess({
            userId: resolvedWorkerProfile.user,
            feature: FEATURES.UNLIMITED_APPLICATIONS,
        });
        if (!hasUnlimitedApplications) {
            const activeApplicationCount = await Application.countDocuments({
                worker: resolvedWorkerProfile._id,
                status: {
                    $in: [
                        'applied',
                        'shortlisted',
                        'interview_requested',
                        'interview_completed',
                        'offer_sent',
                        'offer_accepted',
                        // Legacy values maintained for backward compatibility.
                        'pending',
                        'accepted',
                        'offer_proposed',
                    ],
                },
            });
            const freePlanCap = Number.parseInt(process.env.FREE_PLAN_ACTIVE_APPLICATION_CAP || '25', 10);
            if (activeApplicationCount >= freePlanCap) {
                return res.status(402).json({
                    message: 'Application limit reached for current plan. Upgrade to unlock unlimited applications.',
                    code: 'APPLICATION_LIMIT_REACHED',
                    limit: freePlanCap,
                });
            }
        }

        // 2. Check for existing application
        const existingApp = await Application.findOne({ job: jobId, worker: resolvedWorkerProfile._id });
        if (existingApp) {
            return res.status(400).json({ message: 'Application already exists' });
        }

        // 3. Create Application
        // Employer ID comes from Job document for consistency
        const application = await Application.create({
            job: jobId,
            worker: resolvedWorkerProfile._id,
            employer: job.employerId,
            initiatedBy: normalizedInitiatedBy,
            status: 'applied',
            lastMessage: normalizedInitiatedBy === 'worker' ? 'Applied for this job' : 'Invited you to apply'
        });

        safeLogPlatformEvent({
            type: 'application_submit',
            userId: resolvedWorkerProfile.user,
            meta: {
                applicationId: String(application._id),
                jobId: String(job._id),
                employerId: String(job.employerId),
                initiatedBy: normalizedInitiatedBy,
            },
        });
        fireAndForget('queueTrustRecalculationOnApplication', () => enqueueBackgroundJob({
            type: 'trust_recalculation',
            payload: {
                userId: String(resolvedWorkerProfile.user),
                reason: 'application_submit',
            },
        }), {
            userId: String(resolvedWorkerProfile.user),
            applicationId: String(application._id),
        });

        fireAndForget('trackApplyFunnelStage', () => trackFunnelStage({
            userId: resolvedWorkerProfile.user,
            stage: 'apply',
            source: 'application_create',
            metadata: {
                applicationId: String(application._id),
                jobId: String(job._id),
                initiatedBy: normalizedInitiatedBy,
            },
        }), { applicationId: String(application._id), userId: String(resolvedWorkerProfile.user) });

        fireAndForget('trackApplyFeatureUsage', () => recordFeatureUsage({
            userId: resolvedWorkerProfile.user,
            featureKey: 'job_application_submitted',
            metadata: {
                jobId: String(job._id),
            },
        }), { applicationId: String(application._id), userId: String(resolvedWorkerProfile.user) });

        fireAndForget('evaluateReferralAfterApply', () => evaluateReferralEligibility({
            referredUserId: resolvedWorkerProfile.user,
        }), { applicationId: String(application._id), userId: String(resolvedWorkerProfile.user) });

        // Notify the Employer
        await createNotification({
            user: job.employerId,
            type: 'application_received',
            title: 'New Applicant',
            message: `A new candidate applied to: ${job.title}`,
            relatedData: { jobId: job._id, candidateId: resolvedWorkerProfile._id }
        });
        if (normalizedInitiatedBy === 'employer' && resolvedWorkerProfile?.user) {
            await createNotification({
                user: resolvedWorkerProfile.user,
                type: 'job_match',
                title: 'New job match',
                message: `You have a new job match for ${job.title}.`,
                relatedData: { jobId: job._id, applicationId: application._id },
            });
        }

        // Realtime update for employer-side talent views
        const io = req.app.get('io');
        if (io) {
            io.emit('new_application', {
                applicationId: application._id.toString(),
                jobId: job._id.toString(),
                workerId: resolvedWorkerProfile._id.toString()
            });
        }

        fireAndForget('recordApplicationCreatedLifecycle', () => recordLifecycleEvent({
            eventType: 'APPLICATION_CREATED',
            employerId: job.employerId,
            workerId: resolvedWorkerProfile._id,
            jobId: job._id,
            applicationId: application._id,
            city: job.location || 'Hyderabad',
            roleCluster: job.title || 'general',
            salaryBand: normalizeSalaryBand(job.salaryRange),
            shift: job.shift || 'unknown',
            metadata: {
                initiatedBy: normalizedInitiatedBy,
            },
        }).then(() => recordMatchPerformanceMetric({
            eventName: 'APPLICATION_CREATED',
            jobId: job._id,
            workerId: resolvedWorkerProfile._id,
            applicationId: application._id,
            city: job.location || 'Hyderabad',
            roleCluster: job.title || 'general',
            metadata: {
                initiatedBy: normalizedInitiatedBy,
                source: 'application_controller',
            },
        })), {
            applicationId: String(application._id),
            jobId: String(job._id),
        });

        fireAndForget('queueWebhook.application.received', () => queueWebhookEvent({
            ownerId: job.employerId,
            tenantId: req.user?.organizationId || null,
            eventType: 'application.received',
            payload: {
                applicationId: String(application._id),
                jobId: String(job._id),
                workerId: String(resolvedWorkerProfile._id),
                status: 'applied',
            },
        }), {
            applicationId: String(application._id),
            employerId: String(job.employerId),
        });

        res.status(201).json(application);
    } catch (error) {
        console.warn("Send Request Error:", error);
        res.status(500).json({ message: 'Request failed' });
    }
};

// @desc    Update Application Status (Accept/Reject)
// @route   PUT /api/applications/:id/status
// @access  Private
const updateStatus = async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;
    const normalizedStatus = normalizeApplicationStatus(status, '__invalid__');
    if (normalizedStatus === '__invalid__') {
        return res.status(400).json({ message: 'Invalid status' });
    }

    try {
        const application = req.applicationTransition?.application || await Application.findById(id);
        if (!application) return res.status(404).json({ message: 'Application not found' });

        const workerProfile = await WorkerProfile.findById(application.worker).select('user');
        const employerUserId = String(application.employer?._id || application.employer || '');
        const isEmployer = employerUserId === String(req.user._id);
        const isWorker = String(workerProfile?.user) === String(req.user._id);
        if (!isEmployer && !isWorker) {
            return res.status(403).json({ message: 'Not authorized for this application' });
        }

        if (isEmployer && !EMPLOYER_ALLOWED_TARGETS.has(normalizedStatus)) {
            return res.status(403).json({ message: 'Employers are not allowed to set this status' });
        }
        if (isWorker && !WORKER_ALLOWED_TARGETS.has(normalizedStatus)) {
            return res.status(403).json({ message: 'Candidates are not allowed to set this status' });
        }

        const STATUS_MESSAGE_MAP = {
            applied: 'Application submitted.',
            shortlisted: 'You are shortlisted.',
            interview_requested: 'Interview requested.',
            interview_completed: 'Interview completed.',
            offer_sent: 'Offer sent by employer.',
            offer_accepted: 'Offer accepted.',
            offer_declined: 'Offer declined.',
            rejected: 'Application Rejected.',
            hired: 'Offer confirmed. You are hired.',
            withdrawn: 'Application withdrawn.',
        };

        const transitionResult = await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: normalizedStatus,
            actorType: isEmployer ? 'employer' : 'worker',
            actorId: req.user._id,
            reason: 'manual_status_update',
            metadata: {
                source: 'application_controller',
            },
        });

        const updatedApplication = transitionResult.application;
        updatedApplication.lastMessage = STATUS_MESSAGE_MAP[normalizedStatus] || updatedApplication.lastMessage;
        await updatedApplication.save();

        fireAndForget('queueTrustRecalculationStatusActor', () => enqueueBackgroundJob({
            type: 'trust_recalculation',
            payload: {
                userId: String(req.user._id),
                reason: `application_status_${normalizedStatus}`,
            },
        }), { applicationId: String(updatedApplication._id), userId: String(req.user._id) });
        if (workerProfile?.user) {
            fireAndForget('queueTrustRecalculationStatusWorker', () => enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(workerProfile.user),
                    reason: `application_status_${normalizedStatus}`,
                },
            }), { applicationId: String(updatedApplication._id), userId: String(workerProfile.user) });
        }

        fireAndForget('trackApplicationStatusUsage', () => recordFeatureUsage({
            userId: req.user._id,
            featureKey: `application_status_${normalizedStatus}`,
            metadata: {
                applicationId: String(updatedApplication._id),
                jobId: String(updatedApplication.job),
            },
        }), { applicationId: String(updatedApplication._id), userId: String(req.user._id) });

        if (isEmployer && ['shortlisted', 'interview_requested', 'interview_completed', 'offer_sent', 'offer_accepted', 'rejected', 'hired'].includes(normalizedStatus)) {
            fireAndForget('trackEmployerResponseUsage', () => recordFeatureUsage({
                userId: req.user._id,
                featureKey: 'employer_response_sent',
                metadata: {
                    applicationId: String(updatedApplication._id),
                    responseStatus: normalizedStatus,
                },
            }), { applicationId: String(updatedApplication._id), userId: String(req.user._id) });
        }

        if (workerProfile?.user && ['offer_accepted', 'hired'].includes(normalizedStatus)) {
            fireAndForget('notifyApplicationAccepted', () => createAndSendBehaviorNotification({
                userId: workerProfile.user,
                title: normalizedStatus === 'hired' ? 'Application accepted. You are hired!' : 'Application accepted',
                message: normalizedStatus === 'hired'
                    ? 'Your application has been marked as hired.'
                    : 'An employer accepted your application.',
                notificationType: 'application_accepted',
                pushEventType: 'application_status',
                relatedData: {
                    applicationId: String(updatedApplication._id),
                    status: normalizedStatus,
                },
                dedupeKey: `application_accepted:${String(updatedApplication._id)}:${normalizedStatus}`,
                dedupeWindowHours: 2,
            }), { applicationId: String(updatedApplication._id), userId: String(workerProfile.user) });
        }

        if (workerProfile?.user && ['offer_sent', 'offer_accepted', 'accepted'].includes(normalizedStatus)) {
            fireAndForget('trackOfferFunnelStage', () => trackFunnelStage({
                userId: workerProfile.user,
                stage: 'offer',
                source: 'application_status_update',
                metadata: {
                    applicationId: String(updatedApplication._id),
                    status: normalizedStatus,
                },
            }), { applicationId: String(updatedApplication._id), userId: String(workerProfile.user) });
        }

        if (workerProfile?.user && normalizedStatus === 'hired') {
            fireAndForget('trackHireFunnelStage', () => trackFunnelStage({
                userId: workerProfile.user,
                stage: 'hire',
                source: 'application_status_update',
                metadata: {
                    applicationId: String(updatedApplication._id),
                },
            }), { applicationId: String(updatedApplication._id), userId: String(workerProfile.user) });
            fireAndForget('recomputeWorkerNetworkScoreOnHire', () => recomputeUserNetworkScore({
                userId: workerProfile.user,
            }), { applicationId: String(updatedApplication._id), userId: String(workerProfile.user) });
            fireAndForget('recomputeEmployerNetworkScoreOnHire', () => recomputeUserNetworkScore({
                userId: updatedApplication.employer,
            }), { applicationId: String(updatedApplication._id), userId: String(updatedApplication.employer) });
        }

        if (normalizedStatus === 'shortlisted') {
            fireAndForget('markFirstShortlistOnce', async () => {
                const job = await Job.findById(updatedApplication.job).select('location title salaryRange shift');
                await markFirstShortlistOnce({
                    employerId: updatedApplication.employer,
                    applicationId: updatedApplication._id,
                    jobId: updatedApplication.job,
                    city: job?.location || null,
                });
                await recordLifecycleEvent({
                    eventType: 'APPLICATION_SHORTLISTED',
                    employerId: updatedApplication.employer,
                    workerId: updatedApplication.worker,
                    jobId: updatedApplication.job,
                    applicationId: updatedApplication._id,
                    city: job?.location || 'Hyderabad',
                    roleCluster: job?.title || 'general',
                    salaryBand: normalizeSalaryBand(job?.salaryRange),
                    shift: job?.shift || 'unknown',
                });
                await recordMatchPerformanceMetric({
                    eventName: 'APPLICATION_SHORTLISTED',
                    jobId: updatedApplication.job,
                    workerId: updatedApplication.worker,
                    applicationId: updatedApplication._id,
                    city: job?.location || 'Hyderabad',
                    roleCluster: job?.title || 'general',
                    metadata: {
                        source: 'application_controller',
                    },
                });
            }, { applicationId: String(updatedApplication._id), employerId: String(updatedApplication.employer) });
        }

        if (normalizedStatus === 'hired') {
            fireAndForget('markFirstHireOnce', async () => {
                const job = await Job.findById(updatedApplication.job).select('location title salaryRange shift');
                await markFirstHireOnce({
                    employerId: updatedApplication.employer,
                    applicationId: updatedApplication._id,
                    jobId: updatedApplication.job,
                    city: job?.location || null,
                });
                await recordLifecycleEvent({
                    eventType: 'APPLICATION_HIRED',
                    employerId: updatedApplication.employer,
                    workerId: updatedApplication.worker,
                    jobId: updatedApplication.job,
                    applicationId: updatedApplication._id,
                    city: job?.location || 'Hyderabad',
                    roleCluster: job?.title || 'general',
                    salaryBand: normalizeSalaryBand(job?.salaryRange),
                    shift: job?.shift || 'unknown',
                });
                await recordMatchPerformanceMetric({
                    eventName: 'APPLICATION_HIRED',
                    jobId: updatedApplication.job,
                    workerId: updatedApplication.worker,
                    applicationId: updatedApplication._id,
                    city: job?.location || 'Hyderabad',
                    roleCluster: job?.title || 'general',
                    metadata: {
                        source: 'application_controller',
                    },
                });
                await recordJobFillCompletedOnce({
                    jobId: updatedApplication.job,
                    workerId: updatedApplication.worker,
                    city: job?.location || 'Hyderabad',
                    roleCluster: job?.title || 'general',
                    metadata: {
                        source: 'application_controller',
                        triggerStatus: 'hired',
                        applicationId: String(updatedApplication._id),
                    },
                });
                await recordMatchSnapshotForHire({
                    applicationId: updatedApplication._id,
                });

                await registerHireGraphRelations({
                    applicationId: updatedApplication._id,
                    jobId: updatedApplication.job,
                    employerId: updatedApplication.employer,
                    workerUserId: workerProfile?.user,
                    workerProfileId: updatedApplication.worker,
                    occurredAt: new Date(),
                });

                await ensureFeedbackSlotForHire({
                    applicationId: updatedApplication._id,
                });

                await Application.updateOne(
                    { _id: updatedApplication._id },
                    {
                        $set: {
                            feedbackRequiredByEmployer: true,
                            feedbackRequiredByWorker: true,
                            hiredAt: new Date(),
                        },
                    }
                );

                await Promise.all([
                    recomputeTrustGraphForUser({
                        userId: updatedApplication.employer,
                        reason: `hire_event:${String(updatedApplication._id)}`,
                    }),
                    workerProfile?.user
                        ? recomputeTrustGraphForUser({
                            userId: workerProfile.user,
                            reason: `hire_event:${String(updatedApplication._id)}`,
                        })
                        : Promise.resolve(),
                    computeBadgeForUser({
                        userId: updatedApplication.employer,
                        reason: `hire_event:${String(updatedApplication._id)}`,
                    }),
                    workerProfile?.user
                        ? computeBadgeForUser({
                            userId: workerProfile.user,
                            reason: `hire_event:${String(updatedApplication._id)}`,
                        })
                        : Promise.resolve(),
                    workerProfile?.user
                        ? recomputeSkillReputationForUser({
                            userId: workerProfile.user,
                            reason: `hire_event:${String(updatedApplication._id)}`,
                        })
                        : Promise.resolve(),
                    workerProfile?.user
                        ? applyReferralHireBoost({
                            referredUserId: workerProfile.user,
                            applicationId: updatedApplication._id,
                        })
                        : Promise.resolve(),
                    runNetworkEffectLoopsForUser({ userId: updatedApplication.employer }),
                    workerProfile?.user
                        ? runNetworkEffectLoopsForUser({ userId: workerProfile.user })
                        : Promise.resolve(),
                ]);
            }, { applicationId: String(updatedApplication._id), employerId: String(updatedApplication.employer) });

            fireAndForget('syncHireRecordForReputationGraph', () => ensureHireRecordFromApplication({
                applicationId: updatedApplication._id,
                success: true,
            }), {
                applicationId: String(updatedApplication._id),
                employerId: String(updatedApplication.employer),
            });
        }

        fireAndForget('queueLifecycleAutomationAfterStatusChange', () => enqueueBackgroundJob({
            type: 'lifecycle_automation',
            payload: {
                applicationId: String(updatedApplication._id),
                reason: `status:${normalizedStatus}`,
            },
        }), { applicationId: String(updatedApplication._id) });

        const STATUS_TO_WEBHOOK_EVENT = {
            interview_requested: 'interview.scheduled',
            offer_accepted: 'offer.accepted',
            hired: 'hire.completed',
        };
        const mappedWebhookEvent = STATUS_TO_WEBHOOK_EVENT[normalizedStatus];
        if (mappedWebhookEvent) {
            fireAndForget(`queueWebhook.${mappedWebhookEvent}`, () => queueWebhookEvent({
                ownerId: updatedApplication.employer,
                tenantId: req.user?.organizationId || null,
                eventType: mappedWebhookEvent,
                payload: {
                    applicationId: String(updatedApplication._id),
                    jobId: String(updatedApplication.job),
                    workerId: String(updatedApplication.worker),
                    status: normalizedStatus,
                },
            }), {
                applicationId: String(updatedApplication._id),
                mappedWebhookEvent,
            });
        }

        // Push notification to the candidate side when status changes
        try {
            if (workerProfile?.user) {
                const candidateUser = await User.findById(workerProfile.user).select('pushTokens notificationPreferences');
                await sendPushNotificationForUser(
                    candidateUser,
                    'Application Update',
                    `Your application status is now ${normalizedStatus}.`,
                    { type: 'status', applicationId: updatedApplication._id.toString() },
                    'application_status'
                );
            }
        } catch (pushError) {
            console.warn('Application status push error:', pushError.message);
        }

        res.json(updatedApplication);

    } catch (error) {
        console.warn("Update Status Error:", error);
        if (error.code === 'INVALID_STATUS_TRANSITION') {
            return res.status(409).json({ message: error.message, details: error.details || null });
        }
        res.status(500).json({ message: 'Update failed' });
    }
};

// @desc    Get user's applications
// @route   GET /api/applications
// @access  Private
const getApplications = async (req, res) => {
    try {
        let query = {};
        if (isRecruiter(req.user)) {
            query = { employer: req.user._id };
        } else {
            const workerProfile = await WorkerProfile.findOne({ user: req.user._id }).select('_id');
            if (!workerProfile?._id) {
                return res.json({
                    success: true,
                    count: 0,
                    total: 0,
                    page: 1,
                    pages: 0,
                    data: []
                });
            }
            query = { worker: workerProfile._id };
        }

        if (String(req.query.includeArchived || '').toLowerCase() !== 'true') {
            query.isArchived = { $ne: true };
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const applicationsRaw = await Application.find(query)
            .populate('job', 'title companyName location')
            .populate('worker', 'firstName city totalExperience roleProfiles')
            .populate('employer', 'name') // Populate employer User name
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);

        const applications = applicationsRaw.map((row) => {
            row.status = normalizeApplicationStatus(row.status);
            return row;
        });

        const total = await Application.countDocuments(query);

        res.json({
            success: true,
            count: applications.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: applications
        });
    } catch (error) {
        console.warn("Get Apps Error:", error);
        res.status(500).json({ message: 'Fetch failed' });
    }
};

// @desc    Get Single Application by ID
// @route   GET /api/applications/:id
// @access  Private
const getApplicationById = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate('job', 'title companyName location salaryRange shift requirements createdAt')
            .populate('employer', 'name email industry location phone website trustScore responseScore verificationSignals')
            .populate({
                path: 'worker',
                select: 'user firstName lastName city totalExperience preferredShift roleProfiles isAvailable interviewVerified videoIntroduction settings',
                populate: {
                    path: 'user',
                    select: 'name trustScore responseScore verificationSignals hasCompletedProfile',
                },
            });

        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }

        const employerUserId = String(application.employer?._id || application.employer || '');
        const isEmployer = employerUserId === String(req.user._id);
        const workerUserId = String(application.worker?.user?._id || application.worker?.user || '');
        const isWorker = workerUserId === String(req.user._id);
        if (!isEmployer && !isWorker) {
            return res.status(403).json({ message: 'Not authorized for this application' });
        }

        const employerProfile = await EmployerProfile.findOne({ user: application.employer?._id || application.employer })
            .select('companyName industry location website logoUrl');

        const roleProfiles = Array.isArray(application.worker?.roleProfiles) ? application.worker.roleProfiles : [];
        const uniqueSkills = Array.from(new Set(roleProfiles.flatMap((row) => (
            Array.isArray(row?.skills) ? row.skills.map((skill) => String(skill || '').trim()).filter(Boolean) : []
        ))));
        const expectedSalary = roleProfiles
            .map((row) => Number(row?.expectedSalary))
            .find((value) => Number.isFinite(value) && value > 0) || null;
        const workHistory = roleProfiles
            .filter((row) => row?.roleName)
            .map((row) => ({
                roleName: String(row.roleName),
                experienceInRole: Number(row?.experienceInRole || 0),
            }));
        const completenessChecks = [
            Boolean(application.worker?.firstName),
            Boolean(application.worker?.city),
            Number.isFinite(Number(application.worker?.totalExperience)),
            uniqueSkills.length > 0,
            Boolean(application.worker?.videoIntroduction?.transcript),
            Boolean(application.worker?.interviewVerified),
        ];
        const profileCompleteness = Math.round(
            (completenessChecks.filter(Boolean).length / Math.max(1, completenessChecks.length)) * 100
        );

        const interviewTranscript = String(application.worker?.videoIntroduction?.transcript || '').trim();
        const interviewSummary = interviewTranscript
            ? interviewTranscript.slice(0, 280)
            : null;

        const appPayload = application.toObject ? application.toObject() : application;
        appPayload.chatProfile = {
            candidate: {
                name: [application.worker?.firstName, application.worker?.lastName].filter(Boolean).join(' ').trim() || null,
                skills: uniqueSkills,
                matchPercentage: null,
                trustScore: Number(application.worker?.user?.trustScore || 0),
                responseScore: Number(application.worker?.user?.responseScore || 0),
                badges: application.worker?.interviewVerified ? ['INTERVIEW_VERIFIED'] : [],
                profileCompleteness,
                smartInterviewSummary: interviewSummary,
                resumeUrl: null,
                workHistory,
                availability: application.worker?.isAvailable ? 'Available' : 'Unavailable',
                salaryExpectation: expectedSalary,
            },
            employer: {
                companyName: employerProfile?.companyName || application.employer?.name || null,
                verificationBadge: Boolean(application.employer?.verificationSignals?.companyRegistrationVerified),
                trustLevel: Number(application.employer?.trustScore || 0),
                employerRating: Number(application.employer?.responseScore || 0),
                responseTimeHours: Number(application.sla?.employerResponseHours || 0),
                jobDetails: {
                    title: application.job?.title || null,
                    salary: application.job?.salaryRange || null,
                    location: application.job?.location || null,
                    shift: application.job?.shift || null,
                    postedDate: application.job?.createdAt || null,
                },
                industry: employerProfile?.industry || application.employer?.industry || null,
                website: employerProfile?.website || application.employer?.website || null,
            },
        };

        application.status = normalizeApplicationStatus(application.status);
        appPayload.status = normalizeApplicationStatus(appPayload.status);
        res.json(appPayload);
    } catch (error) {
        console.warn("Get Single App Error:", error);
        res.status(500).json({ message: 'Fetch failed' });
    }
};

module.exports = { sendRequest, updateStatus, getApplications, getApplicationById };
