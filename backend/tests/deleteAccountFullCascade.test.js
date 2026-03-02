const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../services/trustGraphService', () => ({
    recomputeTrustGraphForUser: jest.fn().mockResolvedValue({ ok: true }),
}));

const { deleteUserDataCascade } = require('../services/privacyService');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Escrow = require('../models/Escrow');
const Wallet = require('../models/Wallet');
const Referral = require('../models/Referral');
const GrowthFunnelEvent = require('../models/GrowthFunnelEvent');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const { TrustGraphNode } = require('../models/TrustGraphNode');
const { TrustGraphEdge } = require('../models/TrustGraphEdge');

jest.setTimeout(30000);

describe('delete account full cascade', () => {
    let mongod;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-delete-cascade-tests'));
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

    it('removes/anonymizes all linked data with no orphaned references', async () => {
        const deletingUser = await User.create({
            name: 'Delete Me',
            email: 'delete.me@hirecircle.test',
            password: 'Password123!',
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            hasSelectedRole: true,
        });
        const counterparty = await User.create({
            name: 'Counterparty',
            email: 'counterparty@hirecircle.test',
            password: 'Password123!',
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            hasSelectedRole: true,
        });
        const referredUser = await User.create({
            name: 'Referred User',
            email: 'referred.user@hirecircle.test',
            password: 'Password123!',
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            hasSelectedRole: true,
            referredBy: deletingUser._id,
        });

        const workerProfile = await WorkerProfile.create({
            user: deletingUser._id,
            firstName: 'Delete',
            lastName: 'Me',
            city: 'Hyderabad',
            totalExperience: 2,
            roleProfiles: [{
                roleName: 'Driver',
                experienceInRole: 2,
                expectedSalary: 20000,
                skills: ['Driving'],
            }],
        });

        await EmployerProfile.create({
            user: deletingUser._id,
            companyName: 'Delete Co',
            location: 'Hyderabad',
            industry: 'Logistics',
        });

        const job = await Job.create({
            employerId: deletingUser._id,
            title: 'Driver',
            companyName: 'Delete Co',
            salaryRange: '15000-25000',
            location: 'Hyderabad',
            requirements: ['License'],
        });

        const application = await Application.create({
            job: job._id,
            worker: workerProfile._id,
            employer: deletingUser._id,
            initiatedBy: 'worker',
            status: 'applied',
        });

        const message = await Message.create({
            applicationId: application._id,
            sender: deletingUser._id,
            text: 'hello from soon-to-be deleted user',
        });

        await Escrow.create({
            jobId: job._id,
            employerId: deletingUser._id,
            workerId: counterparty._id,
            amount: 1200,
            currency: 'INR',
            status: 'funded',
            isFrozen: true,
            paymentProvider: 'stripe',
            paymentReferenceId: 'pay_delete_cascade_1',
        });

        await Wallet.create({
            userId: deletingUser._id,
            balance: 1000,
            pendingBalance: 50,
            currency: 'INR',
            kycStatus: 'verified',
        });

        await Referral.create({
            referrerId: deletingUser._id,
            referrer: deletingUser._id,
            referredUserId: counterparty._id,
            candidateName: 'Candidate X',
            candidateContact: '9999999999',
            status: 'pending',
        });

        await GrowthFunnelEvent.create({
            user: deletingUser._id,
            stage: 'signup',
            source: 'test',
        });

        await AnalyticsEvent.create({
            user: deletingUser._id,
            eventName: 'TEST_EVENT',
            metadata: {
                note: 'delete-cascade',
            },
        });

        const deletedNode = await TrustGraphNode.create({
            nodeType: 'User',
            externalId: String(deletingUser._id),
            ownerUserId: deletingUser._id,
        });
        const counterpartyNode = await TrustGraphNode.create({
            nodeType: 'User',
            externalId: String(counterparty._id),
            ownerUserId: counterparty._id,
        });
        await TrustGraphEdge.create({
            fromNode: deletedNode._id,
            toNode: counterpartyNode._id,
            edgeType: 'collaborated',
            edgeKey: `edge:${deletedNode._id}:${counterpartyNode._id}`,
            weight: 1,
        });

        const result = await deleteUserDataCascade({ userId: deletingUser._id });

        expect(result.deleted).toBe(true);
        expect(result.counts.messagesSoftDeleted).toBeGreaterThanOrEqual(1);
        expect(result.counts.referralsDetached).toBeGreaterThanOrEqual(1);
        expect(result.counts.analyticsEventsAnonymized).toBeGreaterThanOrEqual(1);
        expect(result.counts.growthEventsAnonymized).toBeGreaterThanOrEqual(1);
        expect(result.counts.trustEdgesDeleted).toBeGreaterThanOrEqual(1);
        expect(result.counts.trustNodesDeleted).toBeGreaterThanOrEqual(1);
        expect(result.counts.referredByDetached).toBeGreaterThanOrEqual(1);

        const anonymizedUser = await User.findOne({ email: 'deleted-account@hirecircle.invalid' }).lean();
        expect(anonymizedUser).toBeTruthy();

        const [deletedUserAfter, walletAfter, referredUserAfter] = await Promise.all([
            User.findById(deletingUser._id).lean(),
            Wallet.findOne({ userId: deletingUser._id }).lean(),
            User.findById(referredUser._id).lean(),
        ]);
        expect(deletedUserAfter).toBeNull();
        expect(walletAfter).toBeNull();
        expect(referredUserAfter.referredBy).toBeNull();

        const messageAfter = await Message.findById(message._id).lean();
        expect(messageAfter).toBeTruthy();
        expect(messageAfter.isSoftDeleted).toBe(true);
        expect(String(messageAfter.sender)).toBe(String(anonymizedUser._id));
        expect(messageAfter.text).toBe('[deleted by user request]');

        const escrowsAfter = await Escrow.find({}).lean();
        expect(escrowsAfter.length).toBe(1);
        expect(escrowsAfter[0].status).toBe('refunded');
        expect(String(escrowsAfter[0].employerId)).toBe(String(anonymizedUser._id));
        expect(escrowsAfter[0].isFrozen).toBe(false);

        const referralAfter = await Referral.findOne({}).lean();
        expect(referralAfter.referrerId).toBeNull();
        expect(referralAfter.referrer).toBeNull();
        expect(referralAfter.referredUserId).toBeNull();
        expect(referralAfter.candidateName).toBe('[redacted]');
        expect(referralAfter.candidateContact).toBe('[redacted]');

        const growthAfter = await GrowthFunnelEvent.findOne({ source: 'test' }).lean();
        const analyticsAfter = await AnalyticsEvent.findOne({ eventName: 'TEST_EVENT' }).lean();
        expect(String(growthAfter.user)).toBe(String(anonymizedUser._id));
        expect(analyticsAfter.user).toBeNull();
        expect(analyticsAfter.metadata.accountDeletedAnonymized).toBe(true);

        const [jobsDangling, appsDangling, escrowsDangling, trustNodesDangling, trustEdgesDangling] = await Promise.all([
            Job.countDocuments({ employerId: deletingUser._id }),
            Application.countDocuments({
                $or: [
                    { employer: deletingUser._id },
                    { worker: workerProfile._id },
                    { job: job._id },
                ],
            }),
            Escrow.countDocuments({
                $or: [
                    { employerId: deletingUser._id },
                    { workerId: deletingUser._id },
                    { jobId: job._id },
                ],
            }),
            TrustGraphNode.countDocuments({
                $or: [
                    { externalId: String(deletingUser._id) },
                    { ownerUserId: deletingUser._id },
                ],
            }),
            TrustGraphEdge.countDocuments({
                $or: [
                    { fromNode: deletedNode._id },
                    { toNode: deletedNode._id },
                ],
            }),
        ]);

        expect(jobsDangling).toBe(0);
        expect(appsDangling).toBe(0);
        expect(escrowsDangling).toBe(0);
        expect(trustNodesDangling).toBe(0);
        expect(trustEdgesDangling).toBe(0);
    });
});
