const HireRecord = require('../models/HireRecord');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { recordTrustEdge } = require('./trustGraphService');

const clamp = (value, min = 1, max = 5) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const asId = (value) => String(value || '').trim();

const computeRatingVisibility = (hireRecord = {}, now = new Date()) => {
    if (hireRecord.ratingsVisible) return true;
    if (hireRecord.ratingFromEmployer && hireRecord.ratingFromWorker) return true;
    if (hireRecord.ratingRevealAt && new Date(hireRecord.ratingRevealAt).getTime() <= now.getTime()) return true;
    return false;
};

const ensureHireRecord = async ({
    applicationId = null,
    jobId,
    employerId,
    workerId,
    success = true,
    completionTimestamp = new Date(),
    metadata = {},
}) => {
    if (!jobId || !employerId || !workerId) return null;

    const payload = {
        jobId,
        employerId,
        workerId,
        success: Boolean(success),
        completionTimestamp: completionTimestamp instanceof Date ? completionTimestamp : new Date(completionTimestamp),
        metadata: {
            ...metadata,
            applicationId: applicationId ? String(applicationId) : undefined,
        },
    };

    const record = await HireRecord.findOneAndUpdate(
        { jobId, workerId },
        {
            $setOnInsert: payload,
            $set: {
                success: Boolean(success),
                completionTimestamp: payload.completionTimestamp,
                metadata: payload.metadata,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recordTrustEdge({
        fromUserId: employerId,
        toUserId: workerId,
        edgeType: 'hired',
        weight: success ? 82 : 35,
        qualityScore: success ? 20 : -20,
        negative: !success,
        referenceType: 'hire_record',
        referenceId: String(record._id),
        metadata: {
            jobId: String(jobId),
            applicationId: applicationId ? String(applicationId) : undefined,
            success: Boolean(success),
        },
    });

    return record;
};

const ensureHireRecordFromApplication = async ({ applicationId, success = true }) => {
    if (!applicationId) return null;
    const application = await Application.findById(applicationId)
        .select('_id job employer worker updatedAt')
        .lean();
    if (!application) return null;

    const workerProfile = await WorkerProfile.findById(application.worker)
        .select('user')
        .lean();
    if (!workerProfile?.user) return null;

    return ensureHireRecord({
        applicationId: application._id,
        jobId: application.job,
        employerId: application.employer,
        workerId: workerProfile.user,
        success,
        completionTimestamp: application.updatedAt || new Date(),
    });
};

const submitHireRating = async ({ hireRecordId, userId, rating }) => {
    const hireRecord = await HireRecord.findById(hireRecordId);
    if (!hireRecord) {
        const error = new Error('Hire record not found');
        error.code = 'HIRE_RECORD_NOT_FOUND';
        throw error;
    }

    const userIdString = asId(userId);
    const isEmployer = asId(hireRecord.employerId) === userIdString;
    const isWorker = asId(hireRecord.workerId) === userIdString;
    if (!isEmployer && !isWorker) {
        const error = new Error('Not authorized to rate this hire record');
        error.code = 'HIRE_RECORD_FORBIDDEN';
        throw error;
    }

    const normalizedRating = Number(clamp(rating, 1, 5).toFixed(2));

    if (isEmployer) {
        if (hireRecord.ratingFromEmployer !== null && hireRecord.ratingFromEmployer !== undefined) {
            const error = new Error('Employer rating already submitted');
            error.code = 'RATING_IMMUTABLE';
            throw error;
        }
        hireRecord.ratingFromEmployer = normalizedRating;
        hireRecord.employerRatingSubmittedAt = new Date();
    }

    if (isWorker) {
        if (hireRecord.ratingFromWorker !== null && hireRecord.ratingFromWorker !== undefined) {
            const error = new Error('Worker rating already submitted');
            error.code = 'RATING_IMMUTABLE';
            throw error;
        }
        hireRecord.ratingFromWorker = normalizedRating;
        hireRecord.workerRatingSubmittedAt = new Date();
    }

    hireRecord.ratingsVisible = computeRatingVisibility(hireRecord, new Date());
    await hireRecord.save();

    try {
        const { recalculateReputationProfile } = require('./reputationEngineService');
        await Promise.all([
            recalculateReputationProfile({ userId: hireRecord.employerId, reason: 'hire_rating_update' }),
            recalculateReputationProfile({ userId: hireRecord.workerId, reason: 'hire_rating_update' }),
        ]);
    } catch (_error) {
        // Non-blocking reputation refresh.
    }

    return hireRecord;
};

const toViewerSafeHireRecord = ({ hireRecord, viewerId }) => {
    if (!hireRecord) return null;
    const record = typeof hireRecord.toObject === 'function' ? hireRecord.toObject() : { ...hireRecord };
    const viewer = asId(viewerId);
    const isEmployer = asId(record.employerId) === viewer;
    const isWorker = asId(record.workerId) === viewer;
    const canReveal = computeRatingVisibility(record, new Date());

    const response = {
        ...record,
        ratingsVisible: canReveal,
    };

    if (!canReveal) {
        if (!isEmployer) response.ratingFromEmployer = null;
        if (!isWorker) response.ratingFromWorker = null;
    }

    return response;
};

const listHireRecordsForUser = async ({ userId, viewerId, limit = 50 }) => {
    if (!userId) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = await HireRecord.find({
        $or: [{ employerId: userId }, { workerId: userId }],
    })
        .sort({ completionTimestamp: -1 })
        .limit(safeLimit)
        .lean();

    return rows.map((row) => toViewerSafeHireRecord({ hireRecord: row, viewerId }));
};

const refreshHireRatingVisibility = async () => {
    const now = new Date();
    return HireRecord.updateMany(
        {
            ratingsVisible: false,
            ratingRevealAt: { $lte: now },
        },
        { $set: { ratingsVisible: true } }
    );
};

module.exports = {
    computeRatingVisibility,
    ensureHireRecord,
    ensureHireRecordFromApplication,
    submitHireRating,
    toViewerSafeHireRecord,
    listHireRecordsForUser,
    refreshHireRatingVisibility,
};
