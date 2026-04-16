const Application = require('../models/Application');
const EmployerTier = require('../models/EmployerTier');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const normalizeText = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toShiftAdherenceScore = ({ worker, applications }) => {
    const preferredShift = normalizeText(worker?.preferredShift, 'flexible');
    if (!applications.length) return 0.5;

    const hiredApps = applications.filter((row) => row.status === 'hired' && row.job);
    if (!hiredApps.length) return 0.55;

    const aligned = hiredApps.filter((row) => {
        const jobShift = normalizeText(row.job?.shift, 'flexible');
        return preferredShift === 'flexible' || jobShift === 'flexible' || jobShift === preferredShift;
    }).length;

    return clamp(safeDiv(aligned, hiredApps.length), 0, 1);
};

const toSalaryDriftScore = ({ worker, applications }) => {
    const expectedSalary = Number(worker?.roleProfiles?.[0]?.expectedSalary || 0);
    if (!expectedSalary) return 0.5;

    const hiredApps = applications.filter((row) => row.status === 'hired' && row.job?.maxSalary);
    if (!hiredApps.length) return 0.55;

    const avgDrift = hiredApps.reduce((sum, row) => {
        const offered = Number(row.job?.maxSalary || 0);
        const drift = Math.abs(expectedSalary - offered) / Math.max(expectedSalary, 1);
        return sum + drift;
    }, 0) / hiredApps.length;

    return clamp(1 - avgDrift, 0, 1);
};

const toEmployerRetentionScore = async ({ employerId }) => {
    if (!employerId) return 0.5;

    const [lifecycleRows, tierDoc] = await Promise.all([
        HiringLifecycleEvent.aggregate([
            {
                $match: {
                    employerId,
                    eventType: { $in: ['APPLICATION_HIRED', 'RETENTION_30D'] },
                },
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                },
            },
        ]),
        EmployerTier.findOne({ employerId }).select('retention30dRate').lean(),
    ]);

    const hired = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || 0);
    const retained = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);
    const empirical = safeDiv(retained, Math.max(hired, 1));
    const tierRate = Number(tierDoc?.retention30dRate || 0);

    if (hired === 0 && !tierRate) return 0.5;
    if (hired === 0) return clamp(tierRate, 0, 1);

    return clamp((empirical * 0.7) + (tierRate * 0.3), 0, 1);
};

const toRoleClusterVolatility = async ({ city, roleCluster }) => {
    const normalizedCity = normalizeText(city, '');
    const normalizedRole = normalizeText(roleCluster, '');

    if (!normalizedCity || !normalizedRole) return 0.5;

    const [totalApplications, hiredApplications] = await Promise.all([
        Application.aggregate([
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: '$jobDoc' },
            {
                $match: {
                    'jobDoc.location': new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i'),
                    'jobDoc.title': new RegExp(escapeRegex(normalizedRole), 'i'),
                },
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                },
            },
        ]),
        Application.aggregate([
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: '$jobDoc' },
            {
                $match: {
                    status: 'hired',
                    'jobDoc.location': new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i'),
                    'jobDoc.title': new RegExp(escapeRegex(normalizedRole), 'i'),
                },
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const total = Number(totalApplications[0]?.count || 0);
    const hired = Number(hiredApplications[0]?.count || 0);
    if (!total) return 0.5;

    const roleStability = clamp(safeDiv(hired, total), 0, 1);
    return Number(clamp(1 - roleStability, 0, 1).toFixed(4));
};

const predictRetention = async ({ workerId, jobId }) => {
    const [worker, job] = await Promise.all([
        WorkerProfile.findById(workerId)
            .select('_id preferredShift roleProfiles city')
            .lean(),
        Job.findById(jobId)
            .select('_id employerId shift title location')
            .lean(),
    ]);

    if (!worker || !job) {
        throw new Error('Worker or job not found for retention prediction');
    }

    const historicalApplications = await Application.find({
        worker: worker._id,
        status: {
            $in: [
                'hired',
                'shortlisted',
                'interview_completed',
                'offer_sent',
                'offer_accepted',
                // Legacy compatibility.
                'offer_proposed',
            ],
        },
    })
        .sort({ updatedAt: -1 })
        .limit(200)
        .populate('job', 'shift maxSalary title location')
        .select('status updatedAt createdAt job')
        .lean();

    const shiftAdherenceScore = toShiftAdherenceScore({
        worker,
        applications: historicalApplications,
    });
    const salaryDriftScore = toSalaryDriftScore({
        worker,
        applications: historicalApplications,
    });
    const employerRetentionScore = await toEmployerRetentionScore({
        employerId: job.employerId,
    });
    const roleClusterVolatility = await toRoleClusterVolatility({
        city: job.location || worker.city,
        roleCluster: job.title,
    });
    const roleStabilityScore = clamp(1 - roleClusterVolatility, 0, 1);

    const probability30d = clamp(
        (shiftAdherenceScore * 0.25)
        + (salaryDriftScore * 0.2)
        + (employerRetentionScore * 0.3)
        + (roleStabilityScore * 0.25),
        0,
        1
    );

    const riskCategory = probability30d >= 0.7
        ? 'LOW'
        : probability30d >= 0.5
            ? 'MEDIUM'
            : 'HIGH';

    return {
        workerId: worker._id,
        jobId: job._id,
        probabilityStays30d: Number(probability30d.toFixed(4)),
        riskCategory,
        explainability: {
            shiftAdherenceScore: Number(shiftAdherenceScore.toFixed(4)),
            salaryDriftScore: Number(salaryDriftScore.toFixed(4)),
            employerRetentionScore: Number(employerRetentionScore.toFixed(4)),
            roleClusterVolatility: Number(roleClusterVolatility.toFixed(4)),
            roleStabilityScore: Number(roleStabilityScore.toFixed(4)),
            model: 'weighted_retention_v1',
        },
    };
};

module.exports = {
    predictRetention,
};
