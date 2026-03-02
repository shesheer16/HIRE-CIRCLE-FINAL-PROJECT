require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Escrow = require('../models/Escrow');
const FinancialTransaction = require('../models/FinancialTransaction');
const EventEnvelope = require('../models/EventEnvelope');
const DailyUserMetrics = require('../models/DailyUserMetrics');
const DailyJobMetrics = require('../models/DailyJobMetrics');
const DailyFinancialMetrics = require('../models/DailyFinancialMetrics');
const DailyEngagementMetrics = require('../models/DailyEngagementMetrics');
const DailyTrustMetrics = require('../models/DailyTrustMetrics');
const DailyPerformanceMetrics = require('../models/DailyPerformanceMetrics');
const DailyRegionMetrics = require('../models/DailyRegionMetrics');
const FunnelAnalyticsDaily = require('../models/FunnelAnalyticsDaily');
const { runStrategicAnalyticsDaily, toUtcDayWindow } = require('../services/strategicAnalyticsService');

const USERS_TARGET = Number.parseInt(process.env.STRESS_USERS || '10000', 10);
const APPLICATIONS_TARGET = Number.parseInt(process.env.STRESS_APPLICATIONS || '5000', 10);
const HIRES_TARGET = Number.parseInt(process.env.STRESS_HIRES || '1000', 10);
const ESCROW_TARGET = Number.parseInt(process.env.STRESS_ESCROWS || '500', 10);
const EVENTS_TARGET = Number.parseInt(process.env.STRESS_EVENTS || '100000', 10);
const CHUNK_SIZE = Number.parseInt(process.env.STRESS_CHUNK_SIZE || '1000', 10);

const randomInt = (max) => Math.floor(Math.random() * Math.max(1, max));

const inChunks = async (rows, chunkSize, writer) => {
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        // eslint-disable-next-line no-await-in-loop
        await writer(chunk);
    }
};

const buildSyntheticUsers = ({ count, dateKey, dayStartUTC }) => {
    const rows = [];
    for (let i = 0; i < count; i += 1) {
        rows.push({
            name: `Stress User ${dateKey}-${i}`,
            email: `stress_${dateKey.replace(/-/g, '')}_${i}@example.com`,
            password: 'StressPass123!',
            role: i % 2 === 0 ? 'candidate' : 'recruiter',
            roles: ['worker', 'employer'],
            activeRole: i % 2 === 0 ? 'worker' : 'employer',
            primaryRole: i % 2 === 0 ? 'worker' : 'employer',
            hasSelectedRole: true,
            hasCompletedProfile: i % 3 === 0,
            isVerified: true,
            country: i % 2 === 0 ? 'IN' : 'US',
            trustScore: 70 + (i % 30),
            createdAt: new Date(dayStartUTC.getTime() + randomInt(12 * 60 * 60 * 1000)),
            updatedAt: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
        });
    }
    return rows;
};

const buildSyntheticWorkerProfiles = ({ users, dayStartUTC }) => {
    return users.slice(0, Math.floor(users.length / 2)).map((user, idx) => ({
        user: user._id,
        firstName: `Worker${idx}`,
        lastName: 'Stress',
        city: idx % 2 === 0 ? 'Hyderabad' : 'Bengaluru',
        country: idx % 2 === 0 ? 'IN' : 'US',
        isAvailable: true,
        roleProfiles: [{
            roleName: idx % 2 === 0 ? 'driver' : 'cook',
            experienceInRole: 1 + (idx % 8),
            expectedSalary: 15000 + (idx % 5) * 5000,
            skills: idx % 2 === 0 ? ['driving', 'delivery'] : ['cooking', 'kitchen'],
            lastUpdated: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
        }],
        createdAt: new Date(dayStartUTC.getTime() + randomInt(12 * 60 * 60 * 1000)),
        updatedAt: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
    }));
};

const buildSyntheticJobs = ({ employers, dayStartUTC }) => employers.map((user, idx) => ({
    employerId: user._id,
    title: idx % 2 === 0 ? 'Delivery Driver' : 'Kitchen Staff',
    companyName: `Stress Company ${idx}`,
    salaryRange: idx % 2 === 0 ? '15000-25000' : '18000-30000',
    minSalary: idx % 2 === 0 ? 15000 : 18000,
    maxSalary: idx % 2 === 0 ? 25000 : 30000,
    location: idx % 2 === 0 ? 'Hyderabad' : 'Austin',
    country: idx % 2 === 0 ? 'IN' : 'US',
    region: idx % 2 === 0 ? 'IN-HYD' : 'US-TX',
    requirements: idx % 2 === 0 ? ['driving', 'communication'] : ['cooking', 'food safety'],
    status: 'active',
    isOpen: true,
    createdAt: new Date(dayStartUTC.getTime() + randomInt(8 * 60 * 60 * 1000)),
    updatedAt: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
}));

const main = async () => {
    await connectDB();

    const targetDate = process.env.STRESS_TARGET_DATE ? new Date(process.env.STRESS_TARGET_DATE) : new Date(Date.now() - (24 * 60 * 60 * 1000));
    const { dayStartUTC, dayEndUTC, dateKey } = toUtcDayWindow(targetDate);

    const existingDaily = await DailyUserMetrics.findOne({ dateKey }).lean();
    if (existingDaily && String(process.env.STRESS_FORCE || '').toLowerCase() !== 'true') {
        console.log(JSON.stringify({
            skipped: true,
            reason: 'daily metrics already exist for target day; set STRESS_FORCE=true to rerun',
            dateKey,
        }, null, 2));
        process.exit(0);
    }

    const usersRaw = buildSyntheticUsers({
        count: USERS_TARGET,
        dateKey,
        dayStartUTC,
    });
    await inChunks(usersRaw, CHUNK_SIZE, async (chunk) => {
        await User.insertMany(chunk, { ordered: false });
    });
    const users = await User.find({
        email: { $regex: `^stress_${dateKey.replace(/-/g, '')}_` },
    }).select('_id role').lean();

    const workersRaw = buildSyntheticWorkerProfiles({ users, dayStartUTC });
    await inChunks(workersRaw, CHUNK_SIZE, async (chunk) => {
        await WorkerProfile.insertMany(chunk, { ordered: false });
    });
    const workerProfiles = await WorkerProfile.find({
        user: { $in: users.map((u) => u._id) },
    }).select('_id user').lean();

    const employers = users.filter((user) => String(user.role) === 'recruiter').slice(0, 2500);
    const jobsRaw = buildSyntheticJobs({ employers, dayStartUTC });
    await inChunks(jobsRaw, CHUNK_SIZE, async (chunk) => {
        await Job.insertMany(chunk, { ordered: false });
    });
    const jobs = await Job.find({
        employerId: { $in: employers.map((e) => e._id) },
        createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
    }).select('_id employerId').lean();

    const applications = [];
    for (let i = 0; i < APPLICATIONS_TARGET; i += 1) {
        const worker = workerProfiles[randomInt(workerProfiles.length)];
        const job = jobs[randomInt(jobs.length)];
        if (!worker || !job) break;
        applications.push({
            job: job._id,
            worker: worker._id,
            employer: job.employerId,
            initiatedBy: i % 2 === 0 ? 'worker' : 'employer',
            status: i < HIRES_TARGET ? 'hired' : (i % 4 === 0 ? 'shortlisted' : 'pending'),
            createdAt: new Date(dayStartUTC.getTime() + randomInt(10 * 60 * 60 * 1000)),
            updatedAt: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
        });
    }
    await inChunks(applications, CHUNK_SIZE, async (chunk) => {
        await Application.insertMany(chunk, { ordered: false });
    });

    const escrowRows = [];
    const financialRows = [];
    for (let i = 0; i < ESCROW_TARGET; i += 1) {
        const job = jobs[randomInt(jobs.length)];
        const worker = workerProfiles[randomInt(workerProfiles.length)];
        if (!job || !worker) break;
        const amount = 1000 + randomInt(9000);
        escrowRows.push({
            jobId: job._id,
            employerId: job.employerId,
            workerId: worker.user,
            amount,
            currency: 'INR',
            status: i % 3 === 0 ? 'released' : 'funded',
            paymentProvider: 'stripe',
            paymentReferenceId: `stress-escrow-${dateKey}-${i}`,
            createdAt: new Date(dayStartUTC.getTime() + randomInt(12 * 60 * 60 * 1000)),
            releasedAt: i % 3 === 0 ? new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)) : null,
        });
        financialRows.push({
            userId: job.employerId,
            type: 'credit',
            source: 'job_payment',
            referenceId: `stress-revenue-${dateKey}-${i}`,
            amount,
            status: 'completed',
            currency: 'INR',
            balanceBefore: 0,
            balanceAfter: amount,
            pendingBalanceBefore: 0,
            pendingBalanceAfter: 0,
            createdAt: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
        });
    }
    if (escrowRows.length) await Escrow.insertMany(escrowRows, { ordered: false });
    if (financialRows.length) await FinancialTransaction.insertMany(financialRows, { ordered: false });

    const eventTypes = [
        'USER_SIGNUP',
        'OTP_VERIFIED',
        'FUNNEL_STAGE_REACHED',
        'APPLICATION_CREATED',
        'INTERVIEW_CONFIRMED',
        'APPLICATION_SHORTLISTED',
        'APPLICATION_HIRED',
        'AI_CALL_SUCCESS',
        'API_REQUEST_COMPLETED',
    ];
    const eventRows = [];
    for (let i = 0; i < EVENTS_TARGET; i += 1) {
        const actor = users[randomInt(users.length)];
        const eventType = eventTypes[i % eventTypes.length];
        const stage = FUNNEL_STAGE_SEQ[i % FUNNEL_STAGE_SEQ.length];
        eventRows.push({
            eventId: `stress-event-${dateKey}-${i}`,
            eventType,
            actorId: actor ? String(actor._id) : null,
            entityId: null,
            metadata: eventType === 'FUNNEL_STAGE_REACHED'
                ? { stage, role: i % 2 === 0 ? 'driver' : 'cook' }
                : (eventType === 'API_REQUEST_COMPLETED'
                    ? { statusCode: i % 20 === 0 ? 500 : 200, durationMs: 50 + randomInt(1000) }
                    : {}),
            timestampUTC: new Date(dayStartUTC.getTime() + randomInt(24 * 60 * 60 * 1000)),
            region: i % 2 === 0 ? 'IN-HYD' : 'US-TX',
            appVersion: 'stress-test',
            source: 'stress_script',
        });
    }
    await inChunks(eventRows, CHUNK_SIZE, async (chunk) => {
        await EventEnvelope.insertMany(chunk, { ordered: false });
    });

    const result = await runStrategicAnalyticsDaily({
        day: dayStartUTC,
        source: 'stress_validation',
        force: true,
    });

    const [dailyUser, dailyJob, dailyFinancial, dailyEngagement, dailyTrust, dailyPerformance, regionRows, funnelRows] = await Promise.all([
        DailyUserMetrics.countDocuments({ dateKey }),
        DailyJobMetrics.countDocuments({ dateKey }),
        DailyFinancialMetrics.countDocuments({ dateKey }),
        DailyEngagementMetrics.countDocuments({ dateKey }),
        DailyTrustMetrics.countDocuments({ dateKey }),
        DailyPerformanceMetrics.countDocuments({ dateKey }),
        DailyRegionMetrics.countDocuments({ dateKey }),
        FunnelAnalyticsDaily.countDocuments({ dateKey }),
    ]);

    const validation = {
        dateKey,
        stressTargets: {
            users: USERS_TARGET,
            applications: APPLICATIONS_TARGET,
            hires: HIRES_TARGET,
            escrows: ESCROW_TARGET,
            events: EVENTS_TARGET,
        },
        aggregatorResult: result,
        validation: {
            dailyUserMetricsRows: dailyUser,
            dailyJobMetricsRows: dailyJob,
            dailyFinancialMetricsRows: dailyFinancial,
            dailyEngagementMetricsRows: dailyEngagement,
            dailyTrustMetricsRows: dailyTrust,
            dailyPerformanceMetricsRows: dailyPerformance,
            dailyRegionMetricsRows: regionRows,
            funnelAnalyticsRows: funnelRows,
            noDuplicateDailySummaries: [dailyUser, dailyJob, dailyFinancial, dailyEngagement, dailyTrust, dailyPerformance].every((value) => value <= 1),
            noAggregationCrash: true,
        },
    };

    console.log(JSON.stringify(validation, null, 2));
    process.exit(0);
};

const FUNNEL_STAGE_SEQ = ['signup', 'otp', 'interview', 'profile_complete', 'apply', 'interview_completed', 'offer', 'hire'];

main().catch((error) => {
    console.warn('[stress-strategic-analytics] failed:', error.message);
    process.exit(1);
});
