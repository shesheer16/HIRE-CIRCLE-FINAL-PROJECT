const Application = require('../models/Application');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const SmartInterviewAnalyticsSnapshot = require('../models/SmartInterviewAnalyticsSnapshot');

const parseNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const resolveHireOutcome = async (workerProfileId) => {
    if (!workerProfileId) return 'unknown';

    const statuses = await Application.find({ worker: workerProfileId })
        .select('status')
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();

    if (!statuses.length) return 'unknown';
    const normalized = statuses.map((row) => String(row.status || '').toLowerCase());
    if (normalized.includes('hired') || normalized.includes('offer_accepted')) return 'hired';
    if (
        normalized.includes('shortlisted')
        || normalized.includes('interview_requested')
        || normalized.includes('interview_completed')
        || normalized.includes('offer_sent')
        || normalized.includes('accepted')
        || normalized.includes('offer_proposed')
    ) return 'shortlisted';
    if (normalized.includes('rejected')) return 'rejected';
    return 'unknown';
};

const resolveRetention30d = async (workerProfileId) => {
    if (!workerProfileId) return false;
    const retentionEvent = await HiringLifecycleEvent.findOne({
        workerId: workerProfileId,
        eventType: 'RETENTION_30D',
    })
        .select('_id')
        .lean();
    return Boolean(retentionEvent?._id);
};

const captureSmartInterviewAnalyticsSnapshot = async ({
    workerProfile = null,
    processingJob = null,
    role = 'worker',
}) => {
    if (!workerProfile?._id) return null;

    const primaryRole = workerProfile?.roleProfiles?.[0]?.roleName
        || processingJob?.slotState?.primaryRole
        || role
        || 'worker';
    const city = workerProfile?.city || processingJob?.slotState?.city || 'unknown';
    const salary = parseNumber(
        workerProfile?.roleProfiles?.[0]?.expectedSalary
        ?? processingJob?.slotState?.expectedSalary
    );
    const experience = parseNumber(
        workerProfile?.roleProfiles?.[0]?.experienceInRole
        ?? processingJob?.slotState?.totalExperienceYears
    );
    const clarityScore = parseNumber(
        workerProfile?.interviewIntelligence?.communicationClarityScore
        ?? processingJob?.rawMetrics?.communicationClarityScore
    );

    const [hireOutcome, retention30d] = await Promise.all([
        resolveHireOutcome(workerProfile._id),
        resolveRetention30d(workerProfile._id),
    ]);

    return SmartInterviewAnalyticsSnapshot.create({
        role: String(primaryRole || 'worker'),
        city: String(city || 'unknown'),
        experience,
        salary,
        clarityScore,
        hireOutcome,
        retention30d,
        source: 'smart_interview_v4',
        capturedAt: new Date(),
    });
};

module.exports = {
    captureSmartInterviewAnalyticsSnapshot,
};
