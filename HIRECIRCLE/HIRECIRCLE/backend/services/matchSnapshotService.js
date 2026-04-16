const Application = require('../models/Application');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const EmployerTier = require('../models/EmployerTier');
const MatchLog = require('../models/MatchLog');
const MatchSnapshot = require('../models/MatchSnapshot');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');

const normalizeSalaryBand = (job = {}) => {
    if (Number.isFinite(Number(job.maxSalary)) && Number(job.maxSalary) > 0) {
        const maxSalary = Number(job.maxSalary);
        if (maxSalary < 12000) return 'low';
        if (maxSalary < 22000) return 'mid';
        if (maxSalary < 35000) return 'high';
        return 'premium';
    }

    const text = String(job.salaryRange || '').toLowerCase();
    if (text.includes('8k') || text.includes('10k')) return 'low';
    if (text.includes('15k') || text.includes('20k')) return 'mid';
    if (text.includes('30k') || text.includes('40k')) return 'high';
    return 'unknown';
};

const recordMatchSnapshotForHire = async ({ applicationId }) => {
    const application = await Application.findById(applicationId)
        .populate('job', 'location maxSalary salaryRange shift employerId')
        .select('_id job worker employer status createdAt updatedAt')
        .lean();

    if (!application || application.status !== 'hired' || !application.job) {
        return null;
    }

    const [latestMatchLog, employerTier, cityLiquidity, workerEngagement] = await Promise.all([
        MatchLog.findOne({
            jobId: application.job._id,
            workerId: application.worker,
        })
            .sort({ createdAt: -1 })
            .select('finalScore explainability')
            .lean(),
        EmployerTier.findOne({ employerId: application.employer })
            .select('tier')
            .lean(),
        CityLiquidityScore.findOne({
            city: new RegExp(`^${String(application.job.location || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        })
            .sort({ day: -1 })
            .select('activeWorkers30d openJobs workersPerJob')
            .lean(),
        WorkerEngagementScore.findOne({ workerId: application.worker })
            .select('score')
            .lean(),
    ]);

    const cityDensity = cityLiquidity
        ? Number((Number(cityLiquidity.activeWorkers30d || 0) / Math.max(Number(cityLiquidity.openJobs || 0), 1)).toFixed(2))
        : 0;

    const probabilisticScore = Number(latestMatchLog?.finalScore || 0);
    const deterministicScore = Number(
        latestMatchLog?.explainability?.baseScore
        || latestMatchLog?.explainability?.deterministicScore
        || probabilisticScore
        || 0
    );
    const matchScore = probabilisticScore;
    const reliabilityScore = Number(
        latestMatchLog?.explainability?.reliabilityMultiplier
        || latestMatchLog?.explainability?.reliabilityScore
        || 0
    );
    const timeToFillDays = Number(
        ((new Date(application.updatedAt).getTime() - new Date(application.createdAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(2)
    );
    const cityLiquidityScore = Number(cityLiquidity?.workersPerJob || 0);
    const workerEngagementScore = Number(workerEngagement?.score || 0);

    return MatchSnapshot.findOneAndUpdate(
        { applicationId: application._id },
        {
            $set: {
                applicationId: application._id,
                jobId: application.job._id,
                workerId: application.worker,
                employerId: application.employer,
                deterministicScore,
                probabilisticScore,
                matchScore,
                reliabilityScore,
                employerTier: employerTier?.tier || 'Unknown',
                workerEngagementScore,
                cityLiquidityScore,
                retentionOutcome: 'unknown',
                timeToFillDays,
                cityDensity,
                salaryBand: normalizeSalaryBand(application.job),
                shiftType: String(application.job.shift || 'unknown'),
                city: String(application.job.location || 'unknown'),
                snapshotAt: new Date(),
                metadata: {
                    source: 'application_hired_hook',
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

module.exports = {
    recordMatchSnapshotForHire,
};
