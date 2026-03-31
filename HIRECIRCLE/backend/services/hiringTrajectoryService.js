const Application = require('../models/Application');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const HiringTrajectoryModel = require('../models/HiringTrajectoryModel');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const predictWorkerTrajectory = async ({ workerId, upsert = true }) => {
    const worker = await WorkerProfile.findById(workerId)
        .select('_id city roleProfiles')
        .lean();
    if (!worker) return null;

    const hiredApps = await Application.find({
        worker: worker._id,
        status: 'hired',
    })
        .populate('job', 'maxSalary')
        .select('_id job')
        .limit(200)
        .lean();

    const [hiredEvents, retainedEvents] = await Promise.all([
        HiringLifecycleEvent.countDocuments({
            workerId: worker._id,
            eventType: 'APPLICATION_HIRED',
        }),
        HiringLifecycleEvent.countDocuments({
            workerId: worker._id,
            eventType: 'RETENTION_30D',
        }),
    ]);

    const expected = Number(worker.roleProfiles?.[0]?.expectedSalary || 0);
    const hiredSalaries = hiredApps
        .map((row) => Number(row.job?.maxSalary || 0))
        .filter((value) => value > 0);

    const baselineSalary = hiredSalaries.length
        ? hiredSalaries.reduce((sum, value) => sum + value, 0) / hiredSalaries.length
        : expected || 12000;

    const retentionRate = clamp(safeDiv(retainedEvents, Math.max(hiredEvents, 1)), 0, 1);
    const momentum = clamp((retentionRate * 0.6) + (Math.min(hiredSalaries.length, 8) / 8 * 0.4), 0, 1);

    const projection30d = baselineSalary * (1 + (momentum * 0.08));
    const projection90d = baselineSalary * (1 + (momentum * 0.2));
    const projection180d = baselineSalary * (1 + (momentum * 0.35));
    const trajectoryScore = clamp((momentum * 0.7) + (retentionRate * 0.3), 0, 1);
    const confidence = clamp(0.45 + (Math.min(hiredSalaries.length, 10) / 10 * 0.5), 0.45, 0.95);

    const payload = {
        entityType: 'worker',
        entityId: worker._id,
        city: worker.city || 'unknown',
        trajectoryScore: Number(trajectoryScore.toFixed(4)),
        workerEarningPath: {
            in30d: Number(projection30d.toFixed(2)),
            in90d: Number(projection90d.toFixed(2)),
            in180d: Number(projection180d.toFixed(2)),
        },
        employerHiringSuccessPath: {
            in30d: 0,
            in90d: 0,
            in180d: 0,
        },
        confidenceScore: Number(confidence.toFixed(4)),
        computedAt: new Date(),
        factors: {
            baselineSalary: Number(baselineSalary.toFixed(2)),
            retentionRate: Number(retentionRate.toFixed(4)),
            hireCount: hiredSalaries.length,
            momentum: Number(momentum.toFixed(4)),
        },
        anonymizedPatternContext: {
            model: 'worker_trajectory_v1',
            roleCluster: worker.roleProfiles?.[0]?.roleName || 'general',
        },
    };

    if (!upsert) return payload;

    return HiringTrajectoryModel.findOneAndUpdate(
        { entityType: 'worker', entityId: worker._id },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const predictEmployerTrajectory = async ({ employerId, upsert = true }) => {
    const [appStatsRows, lifecycleRows, jobsCount] = await Promise.all([
        Application.aggregate([
            { $match: { employer: employerId } },
            {
                $group: {
                    _id: null,
                    applications: { $sum: 1 },
                    shortlisted: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0],
                        },
                    },
                    hired: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                },
            },
        ]),
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
        Job.countDocuments({ employerId, isOpen: true, status: 'active' }),
    ]);

    const stats = appStatsRows[0] || { applications: 0, shortlisted: 0, hired: 0 };
    const hiredEvents = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || stats.hired || 0);
    const retainedEvents = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);

    const hireRate = clamp(safeDiv(stats.hired, Math.max(stats.shortlisted, 1)), 0, 1);
    const retentionRate = clamp(safeDiv(retainedEvents, Math.max(hiredEvents, 1)), 0, 1);
    const utilization = clamp(Math.min(Number(jobsCount), 12) / 12, 0, 1);
    const successScore = clamp((hireRate * 0.45) + (retentionRate * 0.4) + (utilization * 0.15), 0, 1);
    const confidence = clamp(0.5 + (Math.min(stats.applications, 200) / 200 * 0.4), 0.5, 0.95);

    const payload = {
        entityType: 'employer',
        entityId: employerId,
        city: 'multi_city',
        trajectoryScore: Number(successScore.toFixed(4)),
        workerEarningPath: {
            in30d: 0,
            in90d: 0,
            in180d: 0,
        },
        employerHiringSuccessPath: {
            in30d: Number(clamp(successScore * 0.95, 0, 1).toFixed(4)),
            in90d: Number(clamp(successScore * 1.02, 0, 1).toFixed(4)),
            in180d: Number(clamp(successScore * 1.08, 0, 1).toFixed(4)),
        },
        confidenceScore: Number(confidence.toFixed(4)),
        computedAt: new Date(),
        factors: {
            hireRate: Number(hireRate.toFixed(4)),
            retentionRate: Number(retentionRate.toFixed(4)),
            openJobs: Number(jobsCount || 0),
            applications: Number(stats.applications || 0),
        },
        anonymizedPatternContext: {
            model: 'employer_trajectory_v1',
            cohort: 'employer_success_anonymized',
        },
    };

    if (!upsert) return payload;

    return HiringTrajectoryModel.findOneAndUpdate(
        { entityType: 'employer', entityId: employerId },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const computeHiringTrajectoryBatch = async ({ batchSize = 250, hardCap = 2000 } = {}) => {
    const [workers, employers] = await Promise.all([
        WorkerProfile.find({})
            .select('_id')
            .sort({ _id: 1 })
            .limit(Math.min(batchSize, hardCap))
            .lean(),
        Application.aggregate([
            { $group: { _id: '$employer' } },
            { $limit: Math.min(batchSize, hardCap) },
        ]),
    ]);

    const results = [];
    for (const worker of workers) {
        const prediction = await predictWorkerTrajectory({ workerId: worker._id, upsert: true });
        if (prediction) results.push(prediction);
    }
    for (const employer of employers) {
        const prediction = await predictEmployerTrajectory({ employerId: employer._id, upsert: true });
        if (prediction) results.push(prediction);
    }
    return results;
};

module.exports = {
    predictWorkerTrajectory,
    predictEmployerTrajectory,
    computeHiringTrajectoryBatch,
};
