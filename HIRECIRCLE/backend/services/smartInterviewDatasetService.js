const crypto = require('crypto');
const Application = require('../models/Application');
const SmartInterviewDataset = require('../models/SmartInterviewDataset');

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

const resolveDatasetSalt = () => {
    const explicitSalt = String(process.env.SMART_INTERVIEW_DATASET_SALT || '').trim();
    if (explicitSalt) return explicitSalt;

    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProduction) {
        throw new Error('SMART_INTERVIEW_DATASET_SALT is required in production');
    }

    return 'smart-interview-v4-local-dev-salt';
};

const buildAnonymousKey = ({ workerProfileId, city, role }) => {
    const salt = resolveDatasetSalt();
    return crypto
        .createHash('sha256')
        .update(`${salt}:${String(workerProfileId || '')}:${String(city || '')}:${String(role || '')}`)
        .digest('hex');
};

const captureSmartInterviewDatasetSnapshot = async ({
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
    const experienceYears = parseNumber(
        workerProfile?.roleProfiles?.[0]?.experienceInRole
        ?? processingJob?.slotState?.totalExperienceYears
    );
    const interviewIntelligence = workerProfile?.interviewIntelligence || {};
    const hireOutcome = await resolveHireOutcome(workerProfile._id);

    const doc = await SmartInterviewDataset.create({
        anonymousWorkerKey: buildAnonymousKey({
            workerProfileId: workerProfile._id,
            city,
            role: primaryRole,
        }),
        role: String(primaryRole || 'worker'),
        city: String(city || 'unknown'),
        salary,
        experienceYears,
        hireOutcome,
        profileQualityScore: parseNumber(interviewIntelligence.profileQualityScore),
        communicationClarityScore: parseNumber(interviewIntelligence.communicationClarityScore),
        confidenceLanguageScore: parseNumber(interviewIntelligence.confidenceLanguageScore),
        salaryOutlierFlag: Boolean(interviewIntelligence.salaryOutlierFlag),
        source: 'smart_interview_v4',
        capturedAt: new Date(),
    });

    return doc;
};

module.exports = {
    captureSmartInterviewDatasetSnapshot,
};
