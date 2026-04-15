const Application = require('../models/Application');
const { transitionApplicationStatus } = require('./applicationWorkflowService');
const { normalizeApplicationStatus } = require('../workflow/applicationStateMachine');

const PENDING_APPLICATION_STATUSES = Object.freeze([
    'applied',
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    // Legacy compatibility.
    'requested',
    'pending',
    'accepted',
    'interview',
    'offer_proposed',
]);

const rejectPendingApplicationsForFilledJob = async ({
    jobId,
    actorId = null,
    actorType = 'automation',
    reason = 'job_filled_auto_reject',
} = {}) => {
    const safeJobId = String(jobId || '').trim();
    if (!safeJobId) {
        return {
            processed: 0,
            rejected: 0,
            skipped: 0,
        };
    }

    const applications = await Application.find({
        job: safeJobId,
        status: { $in: PENDING_APPLICATION_STATUSES },
    }).select('_id status');

    let rejected = 0;
    let skipped = 0;

    for (const application of applications) {
        const normalized = normalizeApplicationStatus(application.status, '__invalid__');
        if (['offer_accepted', 'hired', 'rejected', 'withdrawn'].includes(normalized)) {
            skipped += 1;
            continue;
        }

        try {
            await transitionApplicationStatus({
                applicationDoc: application,
                nextStatus: 'rejected',
                actorType,
                actorId,
                reason,
                metadata: {
                    source: 'job_lifecycle_service',
                    autoRejectedBecause: 'job_filled',
                },
            });
            rejected += 1;
        } catch (_error) {
            skipped += 1;
        }
    }

    return {
        processed: applications.length,
        rejected,
        skipped,
    };
};

module.exports = {
    rejectPendingApplicationsForFilledJob,
    PENDING_APPLICATION_STATUSES,
};

