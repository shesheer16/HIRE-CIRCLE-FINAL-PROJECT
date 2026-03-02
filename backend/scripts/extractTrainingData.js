require('dotenv').config();

const fs = require('fs');
const path = require('path');

const connectDB = require('../config/db');
const Application = require('../models/Application');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');

const { evaluateBestRoleForJob, evaluateRoleAgainstJob } = require('../match/matchEngineV2');
const { buildFeatureVector } = require('../match/probabilisticFeatures');

const DAY_MS = 24 * 60 * 60 * 1000;

const toCsvLine = (values = []) => values
    .map((value) => {
        const normalized = value === null || value === undefined ? '' : String(value);
        if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
            return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
    })
    .join(',');

const buildWorkerReliabilityMap = ({ applications = [], retentionSet = new Set(), hiredSet = new Set() }) => {
    const statsByWorker = new Map();

    for (const app of applications) {
        const workerId = String(app.worker);
        const current = statsByWorker.get(workerId) || { applications: 0, retained: 0, hired: 0 };
        current.applications += 1;
        if (retentionSet.has(String(app._id))) current.retained += 1;
        if (hiredSet.has(String(app._id)) || String(app.status || '').toLowerCase() === 'hired') current.hired += 1;
        statsByWorker.set(workerId, current);
    }

    const reliability = new Map();
    for (const [workerId, stats] of statsByWorker.entries()) {
        const score = (stats.retained + 1) / (Math.max(stats.hired, stats.applications) + 2);
        reliability.set(workerId, Math.max(0, Math.min(1, score)));
    }

    return reliability;
};

const main = async () => {
    const windowDays = Number.parseInt(process.env.MATCH_TRAIN_WINDOW_DAYS || '365', 10);
    const observationDays = Number.parseInt(process.env.MATCH_OBSERVATION_DAYS || '30', 10);

    const now = Date.now();
    const windowStart = new Date(now - windowDays * DAY_MS);

    await connectDB();

    const applicationsRaw = await Application.find({ createdAt: { $gte: windowStart } })
        .select('_id job worker employer status createdAt updatedAt')
        .lean();

    const dedupByJobWorker = new Map();
    for (const app of applicationsRaw) {
        const dedupeKey = `${String(app.job)}::${String(app.worker)}`;
        const existing = dedupByJobWorker.get(dedupeKey);
        if (!existing || new Date(app.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
            dedupByJobWorker.set(dedupeKey, app);
        }
    }

    const applications = Array.from(dedupByJobWorker.values());

    const jobIds = [...new Set(applications.map((row) => String(row.job)))];
    const workerIds = [...new Set(applications.map((row) => String(row.worker)))];
    const applicationIds = [...new Set(applications.map((row) => String(row._id)))];

    const [jobs, workers, events] = await Promise.all([
        Job.find({ _id: { $in: jobIds } })
            .select('_id title location requirements minSalary maxSalary salaryRange shift mandatoryLicenses isOpen status createdAt')
            .lean(),
        WorkerProfile.find({ _id: { $in: workerIds } })
            .select('_id user firstName city roleProfiles totalExperience interviewVerified preferredShift licenses createdAt updatedAt lastActiveAt')
            .lean(),
        HiringLifecycleEvent.find({
            occurredAt: { $gte: windowStart },
            $or: [
                { applicationId: { $in: applicationIds } },
                { workerId: { $in: workerIds } },
            ],
            eventType: { $in: ['RETENTION_30D', 'APPLICATION_HIRED', 'INTERVIEW_CONFIRMED'] },
        })
            .select('eventType workerId applicationId occurredAt')
            .lean(),
    ]);

    const jobsById = new Map(jobs.map((row) => [String(row._id), row]));
    const workersById = new Map(workers.map((row) => [String(row._id), row]));

    const userIds = [...new Set(workers.map((row) => row.user).filter(Boolean).map((value) => String(value)))];
    const users = await User.find({ _id: { $in: userIds } })
        .select('_id hasCompletedProfile isVerified')
        .lean();
    const usersById = new Map(users.map((row) => [String(row._id), row]));

    const retentionSet = new Set(
        events
            .filter((event) => event.eventType === 'RETENTION_30D' && event.applicationId)
            .map((event) => String(event.applicationId))
    );

    const hiredSet = new Set(
        events
            .filter((event) => event.eventType === 'APPLICATION_HIRED' && event.applicationId)
            .map((event) => String(event.applicationId))
    );

    const reliabilityByWorker = buildWorkerReliabilityMap({
        applications,
        retentionSet,
        hiredSet,
    });

    const rows = [];
    for (const app of applications) {
        const job = jobsById.get(String(app.job));
        const worker = workersById.get(String(app.worker));
        if (!job || !worker) continue;

        const workerUser = usersById.get(String(worker.user)) || {};

        const best = evaluateBestRoleForJob({
            worker,
            workerUser,
            job,
        });

        const roleData = best?.roleData
            || (Array.isArray(worker.roleProfiles) ? worker.roleProfiles[0] : null);

        if (!roleData) continue;

        const deterministic = best?.accepted
            ? {
                skillScore: best.skillScore,
                experienceScore: best.experienceScore,
                salaryFitScore: best.salaryFitScore,
                distanceScore: best.distanceScore,
                profileCompletenessMultiplier: best.profileCompletenessMultiplier,
            }
            : evaluateRoleAgainstJob({
                job,
                worker,
                workerUser,
                roleData,
            });

        const applicationAgeDays = Math.floor((now - new Date(app.createdAt).getTime()) / DAY_MS);

        let label = -1;
        if (retentionSet.has(String(app._id))) {
            label = 1;
        } else if (applicationAgeDays >= observationDays) {
            label = 0;
        }

        const vector = buildFeatureVector({
            worker,
            workerUser,
            job,
            roleData,
            deterministicScores: deterministic,
            workerReliabilityScore: reliabilityByWorker.get(String(worker._id)) || 0.5,
            timestamp: app.createdAt,
            windowStart,
            windowEnd: new Date(now),
        });

        rows.push({
            applicationId: String(app._id),
            workerId: String(worker._id),
            jobId: String(job._id),
            city: job.location || worker.city || 'unknown',
            roleCluster: roleData.roleName || job.title || 'general',
            label,
            featureOrder: vector.featureOrder,
            featureValues: vector.featureValues,
            features: vector.featureMap,
            rawContext: vector.rawContext,
            metadata: {
                applicationCreatedAt: app.createdAt,
                applicationUpdatedAt: app.updatedAt,
                applicationStatus: app.status,
                observationDays,
            },
        });
    }

    const outputDir = path.join(__dirname, '..', 'training-data');
    fs.mkdirSync(outputDir, { recursive: true });

    const jsonOutputPath = path.join(outputDir, 'match-training.json');
    const csvOutputPath = path.join(outputDir, 'match-training.csv');

    fs.writeFileSync(jsonOutputPath, JSON.stringify(rows, null, 2));

    const csvHeader = [
        'applicationId',
        'workerId',
        'jobId',
        'city',
        'roleCluster',
        'label',
        ...Object.keys(rows[0]?.features || {}),
    ];

    const csvLines = [toCsvLine(csvHeader)];
    for (const row of rows) {
        csvLines.push(toCsvLine([
            row.applicationId,
            row.workerId,
            row.jobId,
            row.city,
            row.roleCluster,
            row.label,
            ...csvHeader.slice(6).map((column) => row.features[column]),
        ]));
    }

    fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

    console.log(JSON.stringify({
        event: 'match_training_data_extracted',
        rows: rows.length,
        jsonOutputPath,
        csvOutputPath,
        windowDays,
        observationDays,
    }, null, 2));

    process.exit(0);
};

main().catch((error) => {
    console.warn('[extractTrainingData] failed:', error.message);
    process.exit(1);
});
