const Application = require('../models/Application');
const HireFeedback = require('../models/HireFeedback');
const WorkerProfile = require('../models/WorkerProfile');
const {
    registerEndorsementRelation,
    recomputeTrustGraphForUser,
} = require('./trustGraphService');
const { recomputeSkillReputationForUser } = require('./skillReputationService');

const clampRating = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 1 || parsed > 5) return null;
    return Math.round(parsed * 10) / 10;
};

const updateFeedbackStatus = (feedbackDoc) => {
    const hasEmployer = Boolean(feedbackDoc?.employerFeedback?.submittedAt);
    const hasWorker = Boolean(feedbackDoc?.workerFeedback?.submittedAt);

    if (hasEmployer && hasWorker) return 'completed';
    if (hasEmployer) return 'employer_submitted';
    if (hasWorker) return 'worker_submitted';
    return 'pending';
};

const ensureFeedbackSlotForHire = async ({ applicationId }) => {
    if (!applicationId) return null;

    const app = await Application.findById(applicationId)
        .select('_id job employer worker status')
        .lean();

    if (!app || app.status !== 'hired') return null;

    const worker = await WorkerProfile.findById(app.worker).select('_id user').lean();
    if (!worker?.user) return null;

    return HireFeedback.findOneAndUpdate(
        { applicationId: app._id },
        {
            $setOnInsert: {
                applicationId: app._id,
                jobId: app.job,
                employerId: app.employer,
                workerProfileId: worker._id,
                workerUserId: worker.user,
                status: 'pending',
            },
            $set: {
                metadata: {
                    source: 'hire_feedback_bootstrap',
                    updatedAt: new Date().toISOString(),
                },
            },
        },
        { upsert: true, new: true }
    );
};

const submitEmployerFeedback = async ({ applicationId, employerId, payload = {} }) => {
    const app = await Application.findById(applicationId)
        .select('_id status employer worker')
        .lean();
    if (!app) {
        const error = new Error('Application not found');
        error.statusCode = 404;
        throw error;
    }

    if (String(app.status) !== 'hired') {
        const error = new Error('Feedback allowed only after hire completion');
        error.statusCode = 400;
        throw error;
    }

    if (String(app.employer) !== String(employerId)) {
        const error = new Error('Not authorized to submit employer feedback');
        error.statusCode = 403;
        throw error;
    }

    const worker = await WorkerProfile.findById(app.worker).select('_id user').lean();
    if (!worker?.user) {
        const error = new Error('Worker profile missing for feedback');
        error.statusCode = 404;
        throw error;
    }

    const feedback = await ensureFeedbackSlotForHire({ applicationId: app._id });

    const skillAccuracy = clampRating(payload.skillAccuracy);
    const communication = clampRating(payload.communication);
    const reliability = clampRating(payload.reliability);

    if ([skillAccuracy, communication, reliability].some((value) => value === null)) {
        const error = new Error('skillAccuracy, communication, and reliability must be 1-5');
        error.statusCode = 400;
        throw error;
    }

    feedback.employerFeedback = {
        skillAccuracy,
        communication,
        reliability,
        submittedAt: new Date(),
    };
    feedback.status = updateFeedbackStatus(feedback);
    await feedback.save();

    const average = (skillAccuracy + communication + reliability) / 3;
    if (average >= 4) {
        await registerEndorsementRelation({
            endorserUserId: employerId,
            targetUserId: worker.user,
            applicationId: app._id,
            weight: Math.min(1.3, 1 + ((average - 4) * 0.15)),
            occurredAt: new Date(),
        });
    }

    await Promise.all([
        recomputeSkillReputationForUser({
            userId: worker.user,
            reason: `employer_feedback:${String(app._id)}`,
        }),
        recomputeTrustGraphForUser({
            userId: worker.user,
            reason: `employer_feedback:${String(app._id)}`,
        }),
        recomputeTrustGraphForUser({
            userId: employerId,
            reason: `employer_feedback_author:${String(app._id)}`,
        }),
    ]);

    return feedback;
};

const submitWorkerFeedback = async ({ applicationId, workerUserId, payload = {} }) => {
    const app = await Application.findById(applicationId)
        .select('_id status employer worker')
        .lean();
    if (!app) {
        const error = new Error('Application not found');
        error.statusCode = 404;
        throw error;
    }

    if (String(app.status) !== 'hired') {
        const error = new Error('Feedback allowed only after hire completion');
        error.statusCode = 400;
        throw error;
    }

    const worker = await WorkerProfile.findById(app.worker).select('_id user').lean();
    if (!worker?.user || String(worker.user) !== String(workerUserId)) {
        const error = new Error('Not authorized to submit worker feedback');
        error.statusCode = 403;
        throw error;
    }

    const feedback = await ensureFeedbackSlotForHire({ applicationId: app._id });

    const jobClarity = clampRating(payload.jobClarity);
    const paymentReliability = clampRating(payload.paymentReliability);
    const interviewFairness = clampRating(payload.interviewFairness);

    if ([jobClarity, paymentReliability, interviewFairness].some((value) => value === null)) {
        const error = new Error('jobClarity, paymentReliability, and interviewFairness must be 1-5');
        error.statusCode = 400;
        throw error;
    }

    feedback.workerFeedback = {
        jobClarity,
        paymentReliability,
        interviewFairness,
        submittedAt: new Date(),
    };
    feedback.status = updateFeedbackStatus(feedback);
    await feedback.save();

    await Promise.all([
        recomputeTrustGraphForUser({
            userId: app.employer,
            reason: `worker_feedback:${String(app._id)}`,
        }),
        recomputeTrustGraphForUser({
            userId: workerUserId,
            reason: `worker_feedback_author:${String(app._id)}`,
        }),
    ]);

    return feedback;
};

const getHireFeedbackStatus = async ({ applicationId }) => {
    if (!applicationId) return null;

    const row = await HireFeedback.findOne({ applicationId })
        .select('status employerFeedback workerFeedback updatedAt')
        .lean();

    if (!row) return null;

    return {
        status: row.status,
        employerFeedbackSubmitted: Boolean(row?.employerFeedback?.submittedAt),
        workerFeedbackSubmitted: Boolean(row?.workerFeedback?.submittedAt),
        updatedAt: row.updatedAt,
    };
};

module.exports = {
    ensureFeedbackSlotForHire,
    submitEmployerFeedback,
    submitWorkerFeedback,
    getHireFeedbackStatus,
};
