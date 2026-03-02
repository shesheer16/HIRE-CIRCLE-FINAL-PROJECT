const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const Message = require('../models/Message');
const PaymentRecord = require('../models/PaymentRecord');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const { fundEscrow, releaseEscrow } = require('../services/financial/escrowService');

jest.setTimeout(45000);

describe('race condition and concurrency stress safety', () => {
    let mongod;

    const createUser = async ({
        email,
        role = 'candidate',
        activeRole = 'worker',
    }) => User.create({
        name: email.split('@')[0],
        email,
        password: 'Password123!',
        role,
        activeRole,
        primaryRole: activeRole,
        hasSelectedRole: true,
        hasCompletedProfile: true,
        isVerified: true,
        isEmailVerified: true,
    });

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.MAX_FINANCIAL_AMOUNT = '10000000';
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-race-condition-stress-tests'));
    });

    beforeEach(async () => {
        await Promise.all(
            Object.values(mongoose.connection.collections || {}).map((collection) => collection.deleteMany({}))
        );
    });

    afterAll(async () => {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.dropDatabase();
            await mongoose.connection.close();
        }
        if (mongod) {
            await mongod.stop();
        }
    });

    it('handles parallel applications/messages/escrow transitions/role updates/interview jobs without state corruption', async () => {
        const employer = await createUser({
            email: 'race.employer@test.com',
            role: 'recruiter',
            activeRole: 'employer',
        });
        const worker = await createUser({
            email: 'race.worker@test.com',
            role: 'candidate',
            activeRole: 'worker',
        });

        const workerProfile = await WorkerProfile.create({
            user: worker._id,
            firstName: 'Race',
            lastName: 'Worker',
            city: 'Hyderabad',
            totalExperience: 3,
            roleProfiles: [{ roleName: 'General', experienceInRole: 3, skills: ['operations'] }],
        });

        const job = await Job.create({
            employerId: employer._id,
            title: 'Operator',
            companyName: 'Hire Labs',
            salaryRange: '10000-20000',
            location: 'Hyderabad',
            requirements: ['discipline'],
            status: 'active',
            isOpen: true,
        });

        await Application.syncIndexes();

        const applicationCreateResults = await Promise.allSettled(
            Array.from({ length: 100 }).map(() => Application.create({
                job: job._id,
                worker: workerProfile._id,
                employer: employer._id,
                initiatedBy: 'worker',
                status: 'applied',
                lastMessage: 'Applied',
            }))
        );

        const appCreateSuccess = applicationCreateResults.filter((entry) => entry.status === 'fulfilled').length;
        const appCreateFailures = applicationCreateResults.filter((entry) => entry.status === 'rejected').length;
        expect(appCreateSuccess).toBe(1);
        expect(appCreateFailures).toBeGreaterThan(0);

        const application = await Application.findOne({
            job: job._id,
            worker: workerProfile._id,
        }).lean();
        expect(application).toBeTruthy();

        await Promise.all(
            Array.from({ length: 50 }).map((_, index) => Message.create({
                applicationId: application._id,
                sender: worker._id,
                text: `parallel message ${index + 1}`,
                dedupeKey: `race-msg-${index + 1}`,
            }))
        );
        const messageCount = await Message.countDocuments({ applicationId: application._id });
        expect(messageCount).toBe(50);

        const paymentRecord = await PaymentRecord.create({
            userId: employer._id,
            provider: 'stripe',
            intentType: 'escrow_funding',
            amount: 999,
            currency: 'INR',
            status: 'captured',
            providerIntentId: 'pi_race_1',
            providerPaymentId: 'ch_race_1',
        });

        const funded = await fundEscrow({
            actorId: employer._id,
            employerId: employer._id,
            workerId: worker._id,
            jobId: job._id,
            amount: 999,
            currency: 'INR',
            paymentRecordId: paymentRecord._id,
        });

        const releaseResults = await Promise.allSettled(
            Array.from({ length: 20 }).map(() => releaseEscrow({
                escrowId: funded.escrow._id,
                actorId: employer._id,
            }))
        );
        const releaseSuccessCount = releaseResults.filter((entry) => entry.status === 'fulfilled').length;
        expect(releaseSuccessCount).toBe(1);

        await Promise.all(
            Array.from({ length: 10 }).map((_, index) => User.updateOne(
                { _id: employer._id },
                {
                    $set: {
                        activeRole: index % 2 === 0 ? 'worker' : 'employer',
                    },
                }
            ))
        );
        const employerAfterRoleWrites = await User.findById(employer._id).lean();
        expect(['worker', 'employer']).toContain(String(employerAfterRoleWrites.activeRole));

        await Promise.all(
            Array.from({ length: 20 }).map((_, index) => InterviewProcessingJob.create({
                userId: worker._id,
                role: 'worker',
                videoUrl: `https://cdn.example.com/interview-${index + 1}.mp4`,
                videoHash: `hash-${index + 1}`,
                status: 'pending',
                idempotencyKey: `smart-interview-race-${index + 1}`,
            }))
        );
        const interviewCount = await InterviewProcessingJob.countDocuments({ userId: worker._id });
        expect(interviewCount).toBe(20);
    });
});
