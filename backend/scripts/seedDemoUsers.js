const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');
const EmployerProfile = require('../models/EmployerProfile');
const EmployerTier = require('../models/EmployerTier');
const Job = require('../models/Job');
const Application = require('../models/Application');
const MatchRun = require('../models/MatchRun');
const MatchLog = require('../models/MatchLog');

dotenv.config({ path: path.join(__dirname, '../.env') });

const DEMO_SEED_TAG = 'demo-seed-v1';
const DEMO_CITY = 'Hyderabad';
const DEMO_PASSWORD = 'Demo@123';

const DEMO_CREDENTIALS = {
    candidate: {
        email: 'demo.worker@hireapp.dev',
        phone: '+919999000001',
        password: DEMO_PASSWORD,
    },
    recruiter: {
        email: 'demo.recruiter@hireapp.dev',
        phone: '+919999000002',
        password: DEMO_PASSWORD,
    },
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const ensureSafeEnvironment = () => {
    const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
    if (nodeEnv === 'production') {
        throw new Error('Refusing to seed demo users in production mode.');
    }

    const mongoUri = String(process.env.MONGO_URI || '').trim();
    if (!mongoUri) {
        throw new Error('MONGO_URI is required.');
    }

    const isRemoteMongo = mongoUri.includes('mongodb+srv://') || mongoUri.includes('.mongodb.net');
    const allowRemote = String(process.env.ALLOW_REMOTE_DEMO_SEED || '').toLowerCase() === 'true';
    if (isRemoteMongo && !allowRemote) {
        throw new Error(
            'Remote MongoDB detected. Set ALLOW_REMOTE_DEMO_SEED=true only for intentional non-production demo environments.'
        );
    }
};

const upsertUser = async ({
    name,
    email,
    phone,
    role,
    city = DEMO_CITY,
    featureToggles = {},
}) => {
    const normalizedEmail = normalizeEmail(email);
    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        user = new User({
            name,
            email: normalizedEmail,
            password: DEMO_PASSWORD,
            role,
        });
    }

    user.name = name;
    user.email = normalizedEmail;
    user.role = role;
    user.primaryRole = role === 'recruiter' ? 'employer' : 'worker';
    user.password = DEMO_PASSWORD;
    user.phoneNumber = phone;
    user.city = city;
    user.hasCompletedProfile = true;
    user.isVerified = true;
    user.isEmailVerified = true;
    user.isDeleted = false;
    user.deletedAt = null;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.acquisitionSource = 'organic';
    user.acquisitionCity = city;
    user.featureToggles = {
        ...(user.featureToggles || {}),
        FEATURE_MATCH_UI_V1: true,
        FEATURE_PROBABILISTIC_MATCH: role === 'recruiter',
        ...featureToggles,
    };

    await user.save();
    return user;
};

const upsertWorkerProfile = async (user, {
    firstName,
    lastName,
    expectedSalary,
    skills,
}) => {
    let profile = await WorkerProfile.findOne({ user: user._id });
    if (!profile) {
        profile = new WorkerProfile({
            user: user._id,
            firstName,
            city: DEMO_CITY,
        });
    }

    profile.firstName = firstName;
    profile.lastName = lastName;
    profile.city = DEMO_CITY;
    profile.totalExperience = 4;
    profile.preferredShift = 'Flexible';
    profile.licenses = [];
    profile.isAvailable = true;
    profile.interviewVerified = true;
    profile.roleProfiles = [
        {
            roleName: 'Demo Delivery Driver',
            experienceInRole: 1,
            expectedSalary,
            skills,
            lastUpdated: new Date(),
        },
    ];
    profile.settings = {
        matchPreferences: {
            maxCommuteDistanceKm: 25,
            salaryExpectationMin: 15000,
            salaryExpectationMax: 28000,
            preferredShiftTimes: ['Flexible'],
            roleClusters: ['Demo Delivery Driver'],
            minimumMatchTier: 'POSSIBLE',
        },
    };

    await profile.save();

    await WorkerEngagementScore.findOneAndUpdate(
        { workerId: profile._id },
        {
            $set: {
                userId: user._id,
                score: 0.82,
                interviewVerified: true,
                applicationFrequency30d: 6,
                shortlistRatio: 0.45,
                avgResponseHours: 4,
                retentionSuccessRate: 0.74,
                badgeEligible: true,
                computedAt: new Date(),
                metadata: {
                    seedTag: DEMO_SEED_TAG,
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return profile;
};

const upsertEmployerProfile = async (user, {
    companyName,
    location = DEMO_CITY,
}) => {
    const profile = await EmployerProfile.findOneAndUpdate(
        { user: user._id },
        {
            $set: {
                companyName,
                industry: 'Logistics',
                location,
                website: 'https://hireapp.dev',
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return profile;
};

const upsertEmployerTier = async (user, tier = 'Gold') => {
    await EmployerTier.findOneAndUpdate(
        { employerId: user._id },
        {
            $set: {
                tier,
                score: 0.88,
                hireCompletionRate: 0.81,
                paymentReliability: 0.9,
                retention30dRate: 0.76,
                responseTimeHours: 6,
                rankingBoostMultiplier: 1.05,
                candidateSurfacingPriority: 1.05,
                computedAt: new Date(),
                metadata: {
                    seedTag: DEMO_SEED_TAG,
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const salarySpecForTier = (tier) => {
    if (tier === 'STRONG') {
        return {
            salaryRange: '₹20,000 - ₹26,000',
            minSalary: 20000,
            maxSalary: 26000,
            requirements: ['Driver', 'Delivery', 'Warehouse'],
        };
    }
    if (tier === 'GOOD') {
        return {
            salaryRange: '₹18,000 - ₹22,000',
            minSalary: 18000,
            maxSalary: 22000,
            requirements: ['Driver', 'Delivery', 'Warehouse', 'Route Planning'],
        };
    }
    return {
        salaryRange: '₹15,000 - ₹16,500',
        minSalary: 15000,
        maxSalary: 16500,
        requirements: ['Driver', 'Delivery', 'Warehouse'],
    };
};

const upsertJob = async ({
    employerId,
    companyName,
    title,
    tier,
}) => {
    const salarySpec = salarySpecForTier(tier);
    let job = await Job.findOne({
        employerId,
        title,
        location: DEMO_CITY,
    });

    if (!job) {
        job = new Job({
            employerId,
            title,
            companyName,
            location: DEMO_CITY,
            shift: 'Flexible',
            status: 'active',
            isOpen: true,
        });
    }

    job.title = title;
    job.companyName = companyName;
    job.location = DEMO_CITY;
    job.salaryRange = salarySpec.salaryRange;
    job.minSalary = salarySpec.minSalary;
    job.maxSalary = salarySpec.maxSalary;
    job.requirements = salarySpec.requirements;
    job.screeningQuestions = ['Can you start immediately?', 'Are you comfortable with route-based shifts?'];
    job.mandatoryLicenses = [];
    job.shift = 'Flexible';
    job.isPulse = false;
    job.isOpen = true;
    job.status = 'active';

    await job.save();
    return job;
};

const createSupportCandidates = async (count) => {
    const workers = [];
    for (let i = 1; i <= count; i += 1) {
        const suffix = String(i).padStart(2, '0');
        const user = await upsertUser({
            name: `Demo Applicant ${suffix}`,
            email: `demo.applicant${suffix}@hireapp.dev`,
            phone: `+91999800${suffix.padStart(4, '0')}`.slice(0, 13),
            role: 'candidate',
            featureToggles: {
                FEATURE_PROBABILISTIC_MATCH: false,
            },
        });

        const profile = await upsertWorkerProfile(user, {
            firstName: 'Demo',
            lastName: `Applicant${suffix}`,
            expectedSalary: 17000,
            skills: ['Driver', 'Delivery', 'Warehouse'],
        });

        workers.push({ user, profile });
    }
    return workers;
};

const upsertApplications = async ({
    recruiterUser,
    recruiterJobs,
    supportWorkers,
}) => {
    const statuses = [
        'hired',
        'shortlisted',
        'shortlisted',
        'pending',
        'pending',
        'pending',
        'accepted',
        'rejected',
        'offer_proposed',
        'offer_accepted',
        'requested',
        'pending',
    ];

    const created = [];
    for (let i = 0; i < statuses.length; i += 1) {
        const worker = supportWorkers[i];
        const job = recruiterJobs[i % recruiterJobs.length];
        const status = statuses[i];

        let application = await Application.findOne({
            job: job._id,
            worker: worker.profile._id,
        });

        if (!application) {
            application = new Application({
                job: job._id,
                worker: worker.profile._id,
                employer: recruiterUser._id,
                initiatedBy: 'worker',
            });
        }

        application.employer = recruiterUser._id;
        application.initiatedBy = 'worker';
        application.status = status;
        application.lastMessage = `Demo status: ${status}`;

        await application.save();
        created.push(application);
    }

    return created;
};

const seedMatchLogs = async ({
    candidateUser,
    candidateProfile,
    seededJobs,
}) => {
    const run = await MatchRun.findOneAndUpdate(
        {
            contextType: 'RECOMMENDED_JOBS',
            workerId: candidateProfile._id,
            userId: candidateUser._id,
            'metadata.seedTag': DEMO_SEED_TAG,
        },
        {
            $set: {
                contextType: 'RECOMMENDED_JOBS',
                workerId: candidateProfile._id,
                userId: candidateUser._id,
                modelVersionUsed: 'demo-seed-model-v1',
                totalJobsConsidered: seededJobs.length,
                totalMatchesReturned: seededJobs.length,
                avgScore: 0.79,
                rejectReasonCounts: {},
                metadata: {
                    seedTag: DEMO_SEED_TAG,
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await MatchLog.deleteMany({ matchRunId: run._id });

    const tierScores = {
        STRONG: 0.9,
        GOOD: 0.76,
        POSSIBLE: 0.64,
    };

    const rows = seededJobs.map((item) => ({
        matchRunId: run._id,
        workerId: candidateProfile._id,
        jobId: item.job._id,
        finalScore: tierScores[item.tier] || 0.62,
        tier: item.tier,
        accepted: true,
        rejectReason: null,
        explainability: {
            seedTag: DEMO_SEED_TAG,
            tier: item.tier,
            confidenceScore: item.tier === 'STRONG' ? 0.92 : item.tier === 'GOOD' ? 0.81 : 0.7,
        },
        matchModelVersionUsed: 'demo-seed-model-v1',
        metadata: {
            seedTag: DEMO_SEED_TAG,
            source: 'seedDemoUsers',
        },
    }));

    if (rows.length) {
        await MatchLog.insertMany(rows);
    }
};

const seedDemoUsers = async () => {
    ensureSafeEnvironment();

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB for demo seeding.');

    try {
        const candidateUser = await upsertUser({
            name: 'Demo Worker',
            email: DEMO_CREDENTIALS.candidate.email,
            phone: DEMO_CREDENTIALS.candidate.phone,
            role: 'candidate',
            featureToggles: {
                FEATURE_PROBABILISTIC_MATCH: false,
                FEATURE_MATCH_UI_V1: true,
            },
        });

        const recruiterUser = await upsertUser({
            name: 'Demo Recruiter',
            email: DEMO_CREDENTIALS.recruiter.email,
            phone: DEMO_CREDENTIALS.recruiter.phone,
            role: 'recruiter',
            featureToggles: {
                FEATURE_PROBABILISTIC_MATCH: true,
                FEATURE_MATCH_UI_V1: true,
            },
        });

        const candidateProfile = await upsertWorkerProfile(candidateUser, {
            firstName: 'Demo',
            lastName: 'Worker',
            expectedSalary: 18000,
            skills: ['Driver', 'Delivery', 'Warehouse'],
        });

        const recruiterProfile = await upsertEmployerProfile(recruiterUser, {
            companyName: 'Demo Fleet Labs',
        });
        await upsertEmployerTier(recruiterUser, 'Gold');

        const auxRecruiterA = await upsertUser({
            name: 'Demo Recruiter A',
            email: 'demo.recruiter.a@hireapp.dev',
            phone: '+919999100001',
            role: 'recruiter',
        });
        const auxRecruiterB = await upsertUser({
            name: 'Demo Recruiter B',
            email: 'demo.recruiter.b@hireapp.dev',
            phone: '+919999100002',
            role: 'recruiter',
        });

        const auxProfileA = await upsertEmployerProfile(auxRecruiterA, {
            companyName: 'Demo Route Ops',
        });
        const auxProfileB = await upsertEmployerProfile(auxRecruiterB, {
            companyName: 'Demo Shift Movers',
        });

        const jobBlueprints = [
            { owner: recruiterUser, companyName: recruiterProfile.companyName, title: 'Demo Delivery Driver - Core Route 1', tier: 'STRONG' },
            { owner: recruiterUser, companyName: recruiterProfile.companyName, title: 'Demo Delivery Driver - Core Route 2', tier: 'STRONG' },
            { owner: recruiterUser, companyName: recruiterProfile.companyName, title: 'Demo Delivery Driver - Core Route 3', tier: 'GOOD' },
            { owner: auxRecruiterA, companyName: auxProfileA.companyName, title: 'Demo Delivery Driver - Priority Lane 1', tier: 'STRONG' },
            { owner: auxRecruiterA, companyName: auxProfileA.companyName, title: 'Demo Delivery Driver - Priority Lane 2', tier: 'STRONG' },
            { owner: auxRecruiterB, companyName: auxProfileB.companyName, title: 'Demo Delivery Driver - Priority Lane 3', tier: 'STRONG' },
            { owner: auxRecruiterB, companyName: auxProfileB.companyName, title: 'Demo Delivery Driver - Standard Lane 1', tier: 'GOOD' },
            { owner: auxRecruiterB, companyName: auxProfileB.companyName, title: 'Demo Delivery Driver - Standard Lane 2', tier: 'GOOD' },
            { owner: auxRecruiterA, companyName: auxProfileA.companyName, title: 'Demo Delivery Driver - Flexible Lane 1', tier: 'POSSIBLE' },
            { owner: auxRecruiterA, companyName: auxProfileA.companyName, title: 'Demo Delivery Driver - Flexible Lane 2', tier: 'POSSIBLE' },
        ];

        const seededJobs = [];
        for (const blueprint of jobBlueprints) {
            const job = await upsertJob({
                employerId: blueprint.owner._id,
                companyName: blueprint.companyName,
                title: blueprint.title,
                tier: blueprint.tier,
            });
            seededJobs.push({ job, tier: blueprint.tier });
        }

        const recruiterJobs = seededJobs
            .filter((item) => String(item.job.employerId) === String(recruiterUser._id))
            .map((item) => item.job);

        const supportWorkers = await createSupportCandidates(12);
        const seededApplications = await upsertApplications({
            recruiterUser,
            recruiterJobs,
            supportWorkers,
        });

        await seedMatchLogs({
            candidateUser,
            candidateProfile,
            seededJobs,
        });

        const tierCounts = seededJobs.reduce((acc, row) => {
            acc[row.tier] = (acc[row.tier] || 0) + 1;
            return acc;
        }, {});

        console.log('Demo seed completed.');
        console.log('--- Demo Credentials ---');
        console.log(`Candidate: ${DEMO_CREDENTIALS.candidate.email} / ${DEMO_PASSWORD}`);
        console.log(`Recruiter: ${DEMO_CREDENTIALS.recruiter.email} / ${DEMO_PASSWORD}`);
        console.log('--- Demo Data Summary ---');
        console.log(`Candidate profile: ${candidateProfile._id}`);
        console.log(`Recruiter profile: ${recruiterProfile._id}`);
        console.log(`Recruiter jobs: ${recruiterJobs.length}`);
        console.log(`Recruiter applications: ${seededApplications.length}`);
        console.log(`Tier mix (target 5/3/2): ${JSON.stringify(tierCounts)}`);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
};

seedDemoUsers().catch((error) => {
    console.warn('[seedDemoUsers] failed:', error.message);
    process.exitCode = 1;
});
