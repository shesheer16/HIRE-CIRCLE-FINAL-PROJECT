const Application = require('../models/Application');
const EmployerTier = require('../models/EmployerTier');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const MatchSnapshot = require('../models/MatchSnapshot');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');
const WorkerProfile = require('../models/WorkerProfile');
const CitySkillGraph = require('../models/CitySkillGraph');
const { predictTimeToFill } = require('./predictiveFillService');
const { predictEmployerTrajectory, predictWorkerTrajectory } = require('./hiringTrajectoryService');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const getTierPerks = (tier = 'Standard') => {
    if (tier === 'Platinum') {
        return ['priority_candidate_surfacing', 'advanced_retention_report', 'predictive_fill_fastlane'];
    }
    if (tier === 'Gold') {
        return ['priority_candidate_surfacing', 'retention_report', 'predictive_fill_dashboard'];
    }
    if (tier === 'Silver') {
        return ['retention_report', 'predictive_fill_dashboard'];
    }
    return ['historical_hire_analytics'];
};

const getEmployerLockInSummary = async ({ employerId }) => {
    const [tierDoc, openJobs, monthlyHires, lifecycleRows] = await Promise.all([
        EmployerTier.findOne({ employerId }).lean(),
        Job.find({ employerId, isOpen: true, status: 'active' })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('_id title location maxSalary salaryRange employerId')
            .lean(),
        Application.aggregate([
            { $match: { employer: employerId, status: 'hired' } },
            {
                $group: {
                    _id: {
                        year: { $year: '$updatedAt' },
                        month: { $month: '$updatedAt' },
                    },
                    hires: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 6 },
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
    ]);

    const [trajectory, fillPredictions] = await Promise.all([
        predictEmployerTrajectory({ employerId, upsert: true }),
        Promise.all(openJobs.map((job) => predictTimeToFill({ jobId: job._id }))),
    ]);

    const hired = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || 0);
    const retained = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);
    const retention30dRate = clamp(safeDiv(retained, Math.max(hired, 1)), 0, 1);

    return {
        employerId,
        tier: tierDoc?.tier || 'Standard',
        tierPerks: getTierPerks(tierDoc?.tier || 'Standard'),
        historicalHireAnalytics: monthlyHires.map((row) => ({
            month: `${row._id.year}-${String(row._id.month).padStart(2, '0')}`,
            hires: Number(row.hires || 0),
        })),
        retentionReport: {
            hiredCount: hired,
            retained30dCount: retained,
            retention30dRate: Number(retention30dRate.toFixed(4)),
        },
        predictiveFillDashboard: fillPredictions.map((prediction) => ({
            jobId: prediction.jobId,
            city: prediction.city,
            roleCluster: prediction.roleCluster,
            expectedDaysToFill: prediction.expectedDaysToFill,
            confidenceRange: prediction.confidenceRange,
        })),
        trajectory: trajectory
            ? {
                trajectoryScore: trajectory.trajectoryScore,
                projectedHiringSuccess: trajectory.employerHiringSuccessPath,
            }
            : null,
    };
};

const getWorkerSkillSuggestions = async ({ worker }) => {
    const workerSkills = new Set(
        (worker.roleProfiles || [])
            .flatMap((row) => row.skills || [])
            .map((skill) => String(skill || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const roleCluster = String(worker.roleProfiles?.[0]?.roleName || '').trim().toLowerCase();
    if (!roleCluster) return [];

    const rows = await CitySkillGraph.find({
        city: new RegExp(`^${String(worker.city || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        roleCluster: new RegExp(`^${String(roleCluster).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })
        .sort({ computedDay: -1, coOccurrenceFrequency: -1 })
        .limit(30)
        .lean();

    return rows
        .filter((row) => !workerSkills.has(String(row.skill || '').toLowerCase()))
        .slice(0, 5)
        .map((row) => ({
            skill: row.skill,
            demandScore: Number(row.hireSuccessProbability || 0),
        }));
};

const getWorkerLockInSummary = async ({ userId }) => {
    const worker = await WorkerProfile.findOne({ user: userId })
        .select('_id user city interviewVerified roleProfiles')
        .lean();
    if (!worker) {
        return null;
    }

    const [engagementRows, snapshots, lifecycleRows, trajectory, skillSuggestions] = await Promise.all([
        WorkerEngagementScore.find({ workerId: worker._id })
            .sort({ computedAt: -1 })
            .limit(12)
            .select('score computedAt')
            .lean(),
        MatchSnapshot.find({ workerId: worker._id })
            .sort({ snapshotAt: -1 })
            .limit(100)
            .select('workerEngagementScore retentionOutcome snapshotAt')
            .lean(),
        HiringLifecycleEvent.aggregate([
            {
                $match: {
                    workerId: worker._id,
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
        predictWorkerTrajectory({ workerId: worker._id, upsert: true }),
        getWorkerSkillSuggestions({ worker }),
    ]);

    const hired = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || 0);
    const retained = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);
    const retentionRate = clamp(safeDiv(retained, Math.max(hired, 1)), 0, 1);

    return {
        workerId: worker._id,
        interviewVerifiedBadge: Boolean(worker.interviewVerified),
        reliabilityScoreHistory: engagementRows.map((row) => ({
            score: Number(row.score || 0),
            computedAt: row.computedAt,
        })),
        retentionTrackRecord: {
            hiredCount: hired,
            retained30dCount: retained,
            retention30dRate: Number(retentionRate.toFixed(4)),
            snapshotRetentionOutcomes: snapshots
                .slice(0, 20)
                .map((row) => row.retentionOutcome),
        },
        skillProgressionSuggestions: skillSuggestions,
        trajectory: trajectory
            ? {
                trajectoryScore: trajectory.trajectoryScore,
                projectedEarningPath: trajectory.workerEarningPath,
            }
            : null,
    };
};

module.exports = {
    getEmployerLockInSummary,
    getWorkerLockInSummary,
};
