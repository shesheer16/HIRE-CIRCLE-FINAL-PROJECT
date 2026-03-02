const User = require('../models/userModel');
const Job = require('../models/Job');
const Offer = require('../models/Offer');
const Escrow = require('../models/Escrow');
const Notification = require('../models/Notification');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const InterviewSchedule = require('../models/InterviewSchedule');
const UserTrustScore = require('../models/UserTrustScore');
const WorkflowSlaSnapshot = require('../models/WorkflowSlaSnapshot');
const ApplicationTransitionLog = require('../models/ApplicationTransitionLog');
const InterviewQualityScore = require('../models/InterviewQualityScore');
const { queueNotificationDispatch } = require('./notificationEngineService');
const { recalculateUserTrustScore } = require('./trustScoreService');
const { transitionApplicationStatus } = require('./applicationWorkflowService');
const {
    CANONICAL_APPLICATION_STATUSES,
    TRANSITION_MAP,
    isTerminalStatus,
} = require('../workflow/applicationStateMachine');

const DEFAULT_LIMIT = Number.parseInt(process.env.LIFECYCLE_AUTOMATION_LIMIT || '500', 10);
const USER_INACTIVE_REMINDER_DAYS = Number.parseInt(process.env.LIFECYCLE_USER_INACTIVE_DAYS || '7', 10);
const EMPLOYER_NO_RESPONSE_DAYS = Number.parseInt(process.env.LIFECYCLE_EMPLOYER_NO_RESPONSE_DAYS || '5', 10);
const CANDIDATE_NO_RESPONSE_DAYS = Number.parseInt(process.env.LIFECYCLE_CANDIDATE_NO_RESPONSE_DAYS || '3', 10);
const OFFER_RESPONSE_EXPIRY_DAYS = Number.parseInt(process.env.LIFECYCLE_OFFER_RESPONSE_EXPIRY_DAYS || '7', 10);
const JOB_EXPIRY_DAYS = Number.parseInt(process.env.LIFECYCLE_JOB_EXPIRY_DAYS || '30', 10);
const INTERVIEW_MISSED_TIMEOUT_MINUTES = Number.parseInt(process.env.INTERVIEW_MISSED_TIMEOUT_MINUTES || '90', 10);
const REJECTED_ARCHIVE_DAYS = Number.parseInt(process.env.REJECTED_ARCHIVE_DAYS || '30', 10);
const CONVERSATION_ARCHIVE_DAYS = Number.parseInt(process.env.CONVERSATION_ARCHIVE_DAYS || '60', 10);
const WORKFLOW_NOTIFICATION_COOLDOWN_HOURS = Number.parseInt(process.env.WORKFLOW_NOTIFICATION_COOLDOWN_HOURS || '24', 10);
const INTERVIEW_QUALITY_THRESHOLD = Number.parseFloat(process.env.INTERVIEW_QUALITY_THRESHOLD || '0.55');
const HIGH_CONFIDENCE_PROFILE_THRESHOLD = Number.parseFloat(process.env.HIGH_CONFIDENCE_PROFILE_THRESHOLD || '0.82');
const LOOP_TRANSITION_THRESHOLD = Number.parseInt(process.env.WORKFLOW_LOOP_TRANSITION_THRESHOLD || '12', 10);

const ACTIVE_PIPELINE_STATUSES = new Set([
    'applied',
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
]);

const toDateBefore = ({ now, days = 0, hours = 0, minutes = 0 }) => {
    const offsetMs = (
        (days * 24 * 60 * 60 * 1000)
        + (hours * 60 * 60 * 1000)
        + (minutes * 60 * 1000)
    );
    return new Date(now.getTime() - offsetMs);
};

const toDateAfter = ({ now, days = 0, hours = 0, minutes = 0 }) => {
    const offsetMs = (
        (days * 24 * 60 * 60 * 1000)
        + (hours * 60 * 60 * 1000)
        + (minutes * 60 * 1000)
    );
    return new Date(now.getTime() + offsetMs);
};

const hasRecentWorkflowNotification = async ({
    userId,
    nudgeType,
    now,
    cooldownHours = WORKFLOW_NOTIFICATION_COOLDOWN_HOURS,
}) => {
    if (!userId || !nudgeType) return false;
    const since = toDateBefore({ now, hours: cooldownHours });
    const existing = await Notification.findOne({
        user: userId,
        'relatedData.nudgeType': nudgeType,
        createdAt: { $gte: since },
    }).select('_id').lean();
    return Boolean(existing?._id);
};

const sendWorkflowNotification = async ({
    userId,
    title,
    message,
    nudgeType,
    relatedData = {},
    now,
    type = 'workflow_reminder',
    cooldownHours = WORKFLOW_NOTIFICATION_COOLDOWN_HOURS,
}) => {
    if (!userId || !title || !message || !nudgeType) return false;

    const alreadySent = await hasRecentWorkflowNotification({
        userId,
        nudgeType,
        now,
        cooldownHours,
    });
    if (alreadySent) return false;

    await queueNotificationDispatch({
        userId,
        type,
        title,
        message,
        relatedData: {
            ...relatedData,
            nudgeType,
        },
        pushCategory: 'application_status',
    });
    return true;
};

const resolveWorkerUserId = async (workerProfileId) => {
    if (!workerProfileId) return null;
    const profile = await WorkerProfile.findById(workerProfileId).select('user').lean();
    return profile?.user || null;
};

const runUserInactivityReminderRule = async ({ now, stats }) => {
    const cutoff = toDateBefore({ now, days: USER_INACTIVE_REMINDER_DAYS });
    const inactiveUsers = await User.find({
        isDeleted: { $ne: true },
        updatedAt: { $lte: cutoff },
        'deletionLifecycle.status': { $ne: 'scheduled' },
    })
        .select('_id')
        .limit(DEFAULT_LIMIT)
        .lean();

    for (const row of inactiveUsers) {
        const sent = await sendWorkflowNotification({
            userId: row._id,
            title: 'We miss you on Hire',
            message: 'New opportunities are waiting. Come back and continue your hiring journey.',
            nudgeType: `user_inactive_reminder:${String(row._id)}`,
            relatedData: {
                reminderType: 'user_inactive_7_days',
            },
            now,
            type: 'reengagement_nudge',
        });
        if (sent) {
            stats.userInactiveReminders += 1;
        }
    }
};

const runEmployerNoResponseRule = async ({ now, stats }) => {
    const cutoff = toDateBefore({ now, days: EMPLOYER_NO_RESPONSE_DAYS });
    const staleApps = await Application.find({
        status: { $in: ['applied', 'pending'] },
        isArchived: { $ne: true },
        statusChangedAt: { $lte: cutoff },
    })
        .select('_id employer job')
        .limit(DEFAULT_LIMIT)
        .lean();

    for (const application of staleApps) {
        const sent = await sendWorkflowNotification({
            userId: application.employer,
            title: 'Pending application needs review',
            message: 'A candidate application is waiting for your response.',
            nudgeType: `employer_no_response:${String(application._id)}`,
            relatedData: {
                applicationId: String(application._id),
                jobId: String(application.job || ''),
                nextAction: 'Review candidate and move to shortlist/reject.',
            },
            now,
        });

        if (sent) {
            stats.employerNoResponseReminders += 1;
            stats.applicationPendingEmployerNudges += 1;
            await Application.updateOne(
                { _id: application._id },
                { $inc: { 'workflowMeta.remindersSent.employerNoResponse': 1 } }
            );
        }
    }
};

const runJobExpiryAutoCloseRule = async ({ now, stats }) => {
    const fallbackExpiryCutoff = toDateBefore({ now, days: JOB_EXPIRY_DAYS });
    const expiringJobs = await Job.find({
        isOpen: true,
        status: 'active',
        isDisabled: { $ne: true },
        $or: [
            { expiresAt: { $lte: now } },
            {
                expiresAt: null,
                createdAt: { $lte: fallbackExpiryCutoff },
            },
        ],
    })
        .select('_id employerId expiresAt title')
        .limit(DEFAULT_LIMIT)
        .lean();

    for (const job of expiringJobs) {
        const closed = await Job.updateOne(
            {
                _id: job._id,
                isOpen: true,
                status: 'active',
            },
            {
                $set: {
                    isOpen: false,
                    status: 'closed',
                    workflowState: 'completed',
                    closedAt: now,
                    closedReason: 'auto_expired',
                },
            }
        );

        if (!Number(closed.modifiedCount || 0)) continue;
        stats.jobsAutoClosedOnExpiry += 1;

        await sendWorkflowNotification({
            userId: job.employerId,
            title: 'Job auto-closed after expiry',
            message: `Your job${job.title ? ` "${job.title}"` : ''} has been auto-closed because it expired.`,
            nudgeType: `job_expired_auto_close:${String(job._id)}`,
            relatedData: {
                jobId: String(job._id),
                nextAction: 'Post a refreshed listing if still hiring.',
            },
            now,
            type: 'lifecycle_automation',
        });
    }
};

const runCandidateInterviewNoResponseRule = async ({ now, stats }) => {
    const cutoff = toDateBefore({ now, days: CANDIDATE_NO_RESPONSE_DAYS });
    const staleApps = await Application.find({
        status: 'interview_requested',
        isArchived: { $ne: true },
        statusChangedAt: { $lte: cutoff },
    })
        .select('_id worker job')
        .limit(DEFAULT_LIMIT);

    for (const application of staleApps) {
        const workerUserId = await resolveWorkerUserId(application.worker);
        const sent = await sendWorkflowNotification({
            userId: workerUserId,
            title: 'Interview response needed',
            message: 'Please confirm or reschedule your interview request.',
            nudgeType: `candidate_interview_no_response:${String(application._id)}`,
            relatedData: {
                applicationId: String(application._id),
                jobId: String(application.job || ''),
                nextAction: 'Respond to interview request.',
            },
            now,
        });

        if (sent) {
            stats.candidateInterviewReminders += 1;
            await Application.updateOne(
                { _id: application._id },
                { $inc: { 'workflowMeta.remindersSent.candidateNoResponse': 1 } }
            );
        }
    }
};

const runInterviewCompletionDecisionPromptRule = async ({ now, stats }) => {
    const completedApps = await Application.find({
        status: 'interview_completed',
        isArchived: { $ne: true },
    })
        .select('_id employer job')
        .limit(DEFAULT_LIMIT)
        .lean();

    for (const application of completedApps) {
        const sent = await sendWorkflowNotification({
            userId: application.employer,
            title: 'Interview complete: decision pending',
            message: 'Interview is complete. Choose offer or rejection to progress hiring.',
            nudgeType: `interview_decision_pending:${String(application._id)}`,
            relatedData: {
                applicationId: String(application._id),
                jobId: String(application.job || ''),
                nextAction: 'Send offer or reject candidate.',
            },
            now,
            cooldownHours: 18,
        });
        if (sent) {
            stats.interviewDecisionPrompts += 1;
        }
    }
};

const expireOfferAndTransitionApplication = async ({ offer, now }) => {
    if (!offer || offer.status !== 'sent') return false;
    offer.status = 'expired';
    offer.expiredAt = now;
    await offer.save();

    const application = await Application.findById(offer.applicationId);
    if (application) {
        await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'offer_declined',
            actorType: 'automation',
            reason: 'offer_expired',
            metadata: {
                offerId: String(offer._id),
            },
        });
    }
    return true;
};

const runOfferExpiryRule = async ({ now, stats }) => {
    const staleByAgeCutoff = toDateBefore({ now, days: OFFER_RESPONSE_EXPIRY_DAYS });
    const offersToExpire = await Offer.find({
        status: 'sent',
        $or: [
            { expiryDate: { $lte: now } },
            { createdAt: { $lte: staleByAgeCutoff } },
        ],
    })
        .limit(DEFAULT_LIMIT);

    for (const offer of offersToExpire) {
        const expired = await expireOfferAndTransitionApplication({ offer, now });
        if (!expired) continue;

        const application = await Application.findById(offer.applicationId).select('_id employer worker job').lean();
        const workerUserId = await resolveWorkerUserId(application?.worker);

        await Promise.all([
            sendWorkflowNotification({
                userId: application?.employer,
                title: 'Offer expired',
                message: 'Offer expired due to no response.',
                nudgeType: `offer_expired:${String(offer._id)}:employer`,
                relatedData: {
                    offerId: String(offer._id),
                    applicationId: String(application?._id || ''),
                    jobId: String(offer.jobId || ''),
                },
                now,
                type: 'offer_update',
            }),
            sendWorkflowNotification({
                userId: workerUserId,
                title: 'Offer expired',
                message: 'Offer expired before a response was recorded.',
                nudgeType: `offer_expired:${String(offer._id)}:worker`,
                relatedData: {
                    offerId: String(offer._id),
                    applicationId: String(application?._id || ''),
                    jobId: String(offer.jobId || ''),
                },
                now,
                type: 'offer_update',
            }),
        ]);

        stats.offersExpired += 1;
    }
};

const runJobFilledAutoCloseRule = async ({ stats }) => {
    const filledJobIds = await Application.distinct('job', { status: 'hired' });
    for (const jobId of filledJobIds.slice(0, DEFAULT_LIMIT)) {
        const job = await Job.findById(jobId);
        if (!job) continue;

        if (job.status !== 'closed') {
            job.status = 'closed';
            job.isOpen = false;
            await job.save();
            stats.jobsAutoClosedOnFill += 1;
        }

        const activeApps = await Application.find({
            job: job._id,
            status: { $in: Array.from(ACTIVE_PIPELINE_STATUSES) },
            isArchived: { $ne: true },
        });

        for (const application of activeApps) {
            if (application.status === 'hired') continue;
            try {
                await transitionApplicationStatus({
                    applicationDoc: application,
                    nextStatus: 'rejected',
                    actorType: 'automation',
                    reason: 'job_filled_auto_close',
                    metadata: {
                        jobId: String(job._id),
                    },
                });
                stats.applicationsAutoClosedOnFill += 1;
            } catch (_error) {
                // Transition guard avoids illegal closures and preserves recoverability.
            }
        }
    }
};

const runInterviewReminderAndTimeoutRules = async ({ now, stats }) => {
    const in24Hours = toDateAfter({ now, hours: 24 });
    const in1Hour = toDateAfter({ now, hours: 1 });
    const timeoutCutoff = toDateBefore({ now, minutes: INTERVIEW_MISSED_TIMEOUT_MINUTES });

    const schedules24h = await InterviewSchedule.find({
        status: 'scheduled',
        reminder24hSentAt: null,
        scheduledTimeUTC: { $gt: in1Hour, $lte: in24Hours },
    }).limit(DEFAULT_LIMIT);

    for (const schedule of schedules24h) {
        const workerUserId = await resolveWorkerUserId(schedule.candidateId);
        await Promise.all([
            sendWorkflowNotification({
                userId: schedule.employerId,
                title: 'Interview reminder (24h)',
                message: 'Interview starts in ~24 hours.',
                nudgeType: `interview_reminder_24h:${String(schedule._id)}:employer`,
                relatedData: {
                    interviewScheduleId: String(schedule._id),
                    applicationId: String(schedule.applicationId),
                    jobId: String(schedule.jobId),
                },
                now,
                type: 'interview_schedule',
            }),
            sendWorkflowNotification({
                userId: workerUserId,
                title: 'Interview reminder (24h)',
                message: 'Your interview is scheduled in ~24 hours.',
                nudgeType: `interview_reminder_24h:${String(schedule._id)}:worker`,
                relatedData: {
                    interviewScheduleId: String(schedule._id),
                    applicationId: String(schedule.applicationId),
                    jobId: String(schedule.jobId),
                },
                now,
                type: 'interview_schedule',
            }),
        ]);
        schedule.reminder24hSentAt = now;
        await schedule.save();
        stats.interviewReminders24h += 1;
    }

    const schedules1h = await InterviewSchedule.find({
        status: 'scheduled',
        reminder1hSentAt: null,
        scheduledTimeUTC: { $gt: now, $lte: in1Hour },
    }).limit(DEFAULT_LIMIT);

    for (const schedule of schedules1h) {
        const workerUserId = await resolveWorkerUserId(schedule.candidateId);
        await Promise.all([
            sendWorkflowNotification({
                userId: schedule.employerId,
                title: 'Interview reminder (1h)',
                message: 'Interview starts in less than 1 hour.',
                nudgeType: `interview_reminder_1h:${String(schedule._id)}:employer`,
                relatedData: {
                    interviewScheduleId: String(schedule._id),
                    applicationId: String(schedule.applicationId),
                    jobId: String(schedule.jobId),
                },
                now,
                type: 'interview_schedule',
            }),
            sendWorkflowNotification({
                userId: workerUserId,
                title: 'Interview reminder (1h)',
                message: 'Your interview starts in less than 1 hour.',
                nudgeType: `interview_reminder_1h:${String(schedule._id)}:worker`,
                relatedData: {
                    interviewScheduleId: String(schedule._id),
                    applicationId: String(schedule.applicationId),
                    jobId: String(schedule.jobId),
                },
                now,
                type: 'interview_schedule',
            }),
        ]);
        schedule.reminder1hSentAt = now;
        await schedule.save();
        stats.interviewReminders1h += 1;
    }

    const missedSchedules = await InterviewSchedule.find({
        status: 'scheduled',
        scheduledTimeUTC: { $lte: timeoutCutoff },
    }).limit(DEFAULT_LIMIT);

    for (const schedule of missedSchedules) {
        schedule.status = 'missed';
        schedule.missedAt = now;
        await schedule.save();
        stats.interviewsAutoMissed += 1;
    }
};

const runSmartInterviewAutoScoreGate = async ({ now, stats }) => {
    const apps = await Application.find({
        status: 'interview_requested',
        isArchived: { $ne: true },
    })
        .populate('worker', 'user interviewIntelligence')
        .limit(DEFAULT_LIMIT);

    for (const application of apps) {
        const workerProfile = application.worker;
        const workerUserId = workerProfile?.user || null;
        const profileQuality = Number(workerProfile?.interviewIntelligence?.profileQualityScore || 0);
        const communicationQuality = Number(workerProfile?.interviewIntelligence?.communicationClarityScore || 0);

        if (profileQuality >= HIGH_CONFIDENCE_PROFILE_THRESHOLD && communicationQuality >= HIGH_CONFIDENCE_PROFILE_THRESHOLD) {
            try {
                await transitionApplicationStatus({
                    applicationDoc: application,
                    nextStatus: 'interview_completed',
                    actorType: 'automation',
                    reason: 'high_confidence_profile_auto_complete',
                    metadata: {
                        profileQuality,
                        communicationQuality,
                    },
                });
                stats.interviewAutoCompletions += 1;
                continue;
            } catch (_error) {
                // Ignore non-transitionable rows.
            }
        }

        if (!workerUserId) continue;
        const latestScore = await InterviewQualityScore.findOne({
            userId: workerUserId,
        })
            .sort({ createdAt: -1 })
            .select('overallQualityScore')
            .lean();

        const qualityScore = Number(latestScore?.overallQualityScore || 0);
        if (qualityScore < INTERVIEW_QUALITY_THRESHOLD) {
            const sent = await sendWorkflowNotification({
                userId: workerUserId,
                title: 'Interview retake recommended',
                message: 'Interview quality score is below threshold. Retake is recommended.',
                nudgeType: `interview_retake:${String(application._id)}`,
                relatedData: {
                    applicationId: String(application._id),
                    qualityScore,
                },
                now,
            });
            if (sent) {
                stats.interviewRetakeSuggestions += 1;
            }
        }
    }
};

const runEscrowAutoFlowRule = async ({ now, stats }) => {
    const acceptedEscrowOffers = await Offer.find({
        status: 'accepted',
        escrowEnabled: true,
    })
        .limit(DEFAULT_LIMIT)
        .lean();

    for (const offer of acceptedEscrowOffers) {
        const workerUserId = await resolveWorkerUserId(offer.candidateId);
        const escrow = await Escrow.findOne({
            jobId: offer.jobId,
            employerId: offer.employerId,
            workerId: workerUserId,
        }).sort({ createdAt: -1 });

        if (!escrow) {
            const sent = await sendWorkflowNotification({
                userId: offer.employerId,
                title: 'Fund escrow to continue',
                message: 'Offer was accepted. Please fund escrow to start work.',
                nudgeType: `escrow_funding_prompt:${String(offer._id)}`,
                relatedData: {
                    offerId: String(offer._id),
                    jobId: String(offer.jobId),
                },
                now,
                type: 'escrow_update',
            });
            if (sent) {
                stats.escrowFundingPrompts += 1;
            }
            continue;
        }

        if (escrow.status === 'funded') {
            await Job.updateOne(
                { _id: offer.jobId },
                { $set: { workflowState: 'in_progress' } }
            );
            stats.jobsMovedInProgress += 1;
        }

        const approvedCompletion = Boolean(escrow?.metadata?.employerCompletionApproved);
        if (escrow.status === 'funded' && approvedCompletion) {
            escrow.status = 'released';
            escrow.releasedAt = now;
            await escrow.save();
            await Job.updateOne(
                { _id: offer.jobId },
                { $set: { workflowState: 'completed' } }
            );

            const application = await Application.findById(offer.applicationId);
            if (application && application.status === 'offer_accepted') {
                await transitionApplicationStatus({
                    applicationDoc: application,
                    nextStatus: 'hired',
                    actorType: 'automation',
                    reason: 'escrow_released_auto_hire',
                    metadata: {
                        escrowId: String(escrow._id),
                        offerId: String(offer._id),
                    },
                });
            }
            stats.escrowAutoReleased += 1;
        }
    }
};

const runAutoArchiveRules = async ({ now, stats }) => {
    const rejectedArchiveCutoff = toDateBefore({ now, days: REJECTED_ARCHIVE_DAYS });
    const conversationArchiveCutoff = toDateBefore({ now, days: CONVERSATION_ARCHIVE_DAYS });

    const rejectedArchiveResult = await Application.updateMany(
        {
            status: { $in: ['rejected', 'withdrawn', 'offer_declined'] },
            isArchived: { $ne: true },
            statusChangedAt: { $lte: rejectedArchiveCutoff },
        },
        {
            $set: {
                isArchived: true,
                archivedAt: now,
            },
        }
    );
    stats.archivedRejectedApplications += Number(rejectedArchiveResult.modifiedCount || 0);

    const closedJobArchiveResult = await Job.updateMany(
        {
            status: 'closed',
            isArchived: { $ne: true },
        },
        {
            $set: {
                isArchived: true,
                archivedAt: now,
            },
        }
    );
    stats.archivedClosedJobs += Number(closedJobArchiveResult.modifiedCount || 0);

    const inactiveConversationArchiveResult = await Application.updateMany(
        {
            status: { $in: ['rejected', 'withdrawn', 'offer_declined', 'hired'] },
            isArchived: { $ne: true },
            conversationLastActiveAt: { $lte: conversationArchiveCutoff },
        },
        {
            $set: {
                isArchived: true,
                archivedAt: now,
            },
        }
    );
    stats.archivedInactiveConversations += Number(inactiveConversationArchiveResult.modifiedCount || 0);
};

const runSlaTrackingRule = async ({ now, stats }) => {
    const [snapshot] = await Application.aggregate([
        {
            $match: {
                isArchived: { $ne: true },
            },
        },
        {
            $group: {
                _id: null,
                employerResponseTimeHours: { $avg: '$sla.employerResponseHours' },
                candidateResponseTimeHours: { $avg: '$sla.candidateResponseHours' },
                averageHiringTimeHours: { $avg: '$sla.hiringDurationHours' },
                sampleSize: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $ne: ['$sla.employerResponseHours', null] },
                                    { $ne: ['$sla.candidateResponseHours', null] },
                                    { $ne: ['$sla.hiringDurationHours', null] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const payload = {
        employerResponseTimeHours: Number(snapshot?.employerResponseTimeHours || 0),
        candidateResponseTimeHours: Number(snapshot?.candidateResponseTimeHours || 0),
        averageHiringTimeHours: Number(snapshot?.averageHiringTimeHours || 0),
        sampleSize: Number(snapshot?.sampleSize || 0),
        computedAt: now,
        metadata: {
            source: 'lifecycle_automation',
        },
    };

    await WorkflowSlaSnapshot.findOneAndUpdate(
        { scopeType: 'global', scopeId: null },
        { $set: payload },
        { upsert: true, new: true }
    );
    stats.slaSnapshotUpdated = true;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value || 0)));
const clamp100 = (value) => Math.max(0, Math.min(100, Number(value || 0)));

const runAbandonmentDetectionRule = async ({ now, stats }) => {
    const ninetyDaysAgo = toDateBefore({ now, days: 90 });

    const candidateDropRows = await InterviewSchedule.aggregate([
        {
            $match: {
                createdAt: { $gte: ninetyDaysAgo },
            },
        },
        {
            $group: {
                _id: '$candidateId',
                total: { $sum: 1 },
                missed: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
            },
        },
        {
            $match: {
                total: { $gte: 4 },
                missed: { $gte: 2 },
            },
        },
        { $limit: DEFAULT_LIMIT },
    ]);

    for (const row of candidateDropRows) {
        const missedRatio = Number(row.missed || 0) / Math.max(Number(row.total || 1), 1);
        if (missedRatio < 0.5) continue;
        const profile = await WorkerProfile.findById(row._id).select('_id user reliabilityScore');
        if (!profile) continue;

        profile.reliabilityScore = clamp01(Number(profile.reliabilityScore || 0.75) - 0.05);
        await profile.save();
        stats.candidateReliabilityPenalties += 1;

        if (profile.user) {
            await recalculateUserTrustScore({
                userId: profile.user,
                reason: 'candidate_interview_abandonment',
            });
        }
    }

    const employerGhostRows = await Application.aggregate([
        {
            $match: {
                status: 'applied',
                isArchived: { $ne: true },
                statusChangedAt: { $lte: toDateBefore({ now, days: EMPLOYER_NO_RESPONSE_DAYS }) },
            },
        },
        {
            $group: {
                _id: '$employer',
                staleApplications: { $sum: 1 },
            },
        },
        {
            $match: {
                staleApplications: { $gte: 5 },
            },
        },
        { $limit: DEFAULT_LIMIT },
    ]);

    for (const row of employerGhostRows) {
        const employerId = row._id;
        const user = await User.findById(employerId).select('_id responseScore');
        if (!user) continue;
        user.responseScore = clamp100(Number(user.responseScore == null ? 100 : user.responseScore) - 5);
        await user.save();

        await UserTrustScore.findOneAndUpdate(
            { userId: employerId },
            {
                $set: {
                    'metadata.ghostingStaleApplicationCount': Number(row.staleApplications || 0),
                    'metadata.responseScore': Number(user.responseScore || 0),
                    'metadata.workflowUpdatedAt': now.toISOString(),
                },
            },
            { upsert: true }
        );

        await recalculateUserTrustScore({
            userId: employerId,
            reason: 'employer_ghosting_pattern',
        });
        stats.employerResponsePenalties += 1;
    }
};

const evaluateWorkflowSafetyInvariants = async ({ now = new Date() } = {}) => {
    const twentyFourHoursAgo = toDateBefore({ now, hours: 24 });

    const loopRows = await ApplicationTransitionLog.aggregate([
        {
            $match: {
                createdAt: { $gte: twentyFourHoursAgo },
            },
        },
        {
            $group: {
                _id: '$applicationId',
                transitions: { $sum: 1 },
            },
        },
        {
            $match: {
                transitions: { $gt: LOOP_TRANSITION_THRESHOLD },
            },
        },
        { $limit: DEFAULT_LIMIT },
    ]);

    const duplicateOfferRows = await Offer.aggregate([
        {
            $match: {
                status: { $in: ['sent', 'accepted'] },
            },
        },
        {
            $group: {
                _id: '$applicationId',
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gt: 1 },
            },
        },
        { $limit: DEFAULT_LIMIT },
    ]);

    let duplicateOfferFixes = 0;
    for (const row of duplicateOfferRows) {
        const offers = await Offer.find({
            applicationId: row._id,
            status: { $in: ['sent', 'accepted'] },
        }).sort({ createdAt: -1 });

        // Keep the latest active record, cancel older "sent" offers.
        const [, ...duplicates] = offers;
        for (const offer of duplicates) {
            if (offer.status === 'sent') {
                offer.status = 'cancelled';
                await offer.save();
                duplicateOfferFixes += 1;
            }
        }
    }

    const stuckIntermediateCount = await Application.countDocuments({
        isArchived: { $ne: true },
        $or: [
            {
                status: 'interview_requested',
                statusChangedAt: { $lte: toDateBefore({ now, days: 14 }) },
            },
            {
                status: 'offer_sent',
                statusChangedAt: { $lte: toDateBefore({ now, days: 10 }) },
            },
        ],
    });

    const transitionsExhaustive = CANONICAL_APPLICATION_STATUSES.every((status) => {
        if (isTerminalStatus(status)) return true;
        return Array.isArray(TRANSITION_MAP[status]) && TRANSITION_MAP[status].length > 0;
    });

    return {
        noInfiniteTransitionLoops: loopRows.length === 0,
        loopRiskCount: loopRows.length,
        noDoubleOfferIssue: duplicateOfferRows.length === 0,
        duplicateOfferConflictCount: duplicateOfferRows.length,
        duplicateOfferFixes,
        stuckIntermediateCount: Number(stuckIntermediateCount || 0),
        stateRecoverable: transitionsExhaustive,
        transitionsLogged: true,
    };
};

const runLifecycleAutomations = async (options = {}) => {
    const now = new Date();

    const stats = {
        runAt: now.toISOString(),
        source: options?.source || 'unspecified',
        userInactiveReminders: 0,
        employerNoResponseReminders: 0,
        applicationPendingEmployerNudges: 0,
        candidateInterviewReminders: 0,
        interviewDecisionPrompts: 0,
        offersExpired: 0,
        jobsAutoClosedOnFill: 0,
        jobsAutoClosedOnExpiry: 0,
        applicationsAutoClosedOnFill: 0,
        interviewReminders24h: 0,
        interviewReminders1h: 0,
        interviewsAutoMissed: 0,
        interviewRetakeSuggestions: 0,
        interviewAutoCompletions: 0,
        escrowFundingPrompts: 0,
        jobsMovedInProgress: 0,
        escrowAutoReleased: 0,
        archivedRejectedApplications: 0,
        archivedClosedJobs: 0,
        archivedInactiveConversations: 0,
        slaSnapshotUpdated: false,
        candidateReliabilityPenalties: 0,
        employerResponsePenalties: 0,
        safety: null,
    };

    await runUserInactivityReminderRule({ now, stats });
    await runEmployerNoResponseRule({ now, stats });
    await runCandidateInterviewNoResponseRule({ now, stats });
    await runInterviewCompletionDecisionPromptRule({ now, stats });
    await runOfferExpiryRule({ now, stats });
    await runJobFilledAutoCloseRule({ stats });
    await runJobExpiryAutoCloseRule({ now, stats });
    await runInterviewReminderAndTimeoutRules({ now, stats });
    await runSmartInterviewAutoScoreGate({ now, stats });
    await runEscrowAutoFlowRule({ now, stats });
    await runAutoArchiveRules({ now, stats });
    await runSlaTrackingRule({ now, stats });
    await runAbandonmentDetectionRule({ now, stats });
    stats.safety = await evaluateWorkflowSafetyInvariants({ now });

    return stats;
};

module.exports = {
    runLifecycleAutomations,
    evaluateWorkflowSafetyInvariants,
};
