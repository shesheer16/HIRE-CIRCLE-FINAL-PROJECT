require('dotenv').config();

const connectDB = require('../config/db');
const Application = require('../models/Application');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const MatchSnapshot = require('../models/MatchSnapshot');
const { normalizeSalaryBand } = require('../services/revenueInstrumentationService');
const { recordMatchPerformanceMetric } = require('../services/matchMetricsService');

const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_EVENT_DAYS || '30', 10);
const MAX_APPS_PER_RUN = Number.parseInt(process.env.RETENTION_EVENT_MAX_APPS || '1000', 10);

const runRetentionEventJob = async () => {
    const threshold = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const hiredApps = await Application.find({
        status: 'hired',
        updatedAt: { $lte: threshold },
    })
        .sort({ updatedAt: -1 })
        .limit(MAX_APPS_PER_RUN)
        .select('_id job worker employer updatedAt');

    let upsertedCount = 0;
    for (const app of hiredApps) {
        const [job, workerProfile] = await Promise.all([
            Job.findById(app.job).select('location title salaryRange shift'),
            WorkerProfile.findById(app.worker).select('roleProfiles'),
        ]);

        const roleCluster = workerProfile?.roleProfiles?.[0]?.roleName || job?.title || 'general';
        const result = await HiringLifecycleEvent.updateOne(
            {
                eventType: 'RETENTION_30D',
                applicationId: app._id,
            },
            {
                $setOnInsert: {
                    eventType: 'RETENTION_30D',
                    employerId: app.employer,
                    workerId: app.worker,
                    jobId: app.job,
                    applicationId: app._id,
                    city: job?.location || 'Hyderabad',
                    roleCluster,
                    salaryBand: normalizeSalaryBand(job?.salaryRange),
                    shift: job?.shift || 'unknown',
                    occurredAt: new Date(),
                    metadata: {
                        hiredAt: app.updatedAt,
                    },
                },
            },
            { upsert: true }
        );

        if (result?.upsertedCount) upsertedCount += 1;
        if (result?.upsertedCount) {
            await MatchSnapshot.updateOne(
                { applicationId: app._id },
                {
                    $set: {
                        retentionOutcome: 'retained_30d',
                    },
                }
            );
        }
        if (result?.upsertedCount) {
            await recordMatchPerformanceMetric({
                eventName: 'WORKER_JOINED',
                jobId: app.job,
                workerId: app.worker,
                applicationId: app._id,
                city: job?.location || 'Hyderabad',
                roleCluster,
                timestamp: new Date(),
                metadata: {
                    source: 'retention_30d_cron',
                    hiredAt: app.updatedAt,
                },
            });
        }
    }

    console.log(`[retention-30d] processed ${hiredApps.length}, upserted ${upsertedCount}`);
};

const main = async () => {
    await connectDB();
    await runRetentionEventJob();
    process.exit(0);
};

main().catch((error) => {
    console.warn('[retention-30d] failed:', error.message);
    process.exit(1);
});
