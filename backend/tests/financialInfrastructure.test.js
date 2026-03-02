const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

jest.mock('../services/payments/paymentService', () => ({
    createPaymentIntent: jest.fn(),
    verifyPayment: jest.fn(),
    handleWebhook: jest.fn(),
    refundPayment: jest.fn(),
}));

const paymentService = require('../services/payments/paymentService');
const User = require('../models/userModel');
const Job = require('../models/Job');
const Wallet = require('../models/Wallet');
const Escrow = require('../models/Escrow');
const PaymentRecord = require('../models/PaymentRecord');
const FraudFlag = require('../models/FraudFlag');
const WebhookEventLog = require('../models/WebhookEventLog');

const { fundEscrow, releaseEscrow } = require('../services/financial/escrowService');
const { processWebhook, refundPaymentRecord } = require('../services/financial/paymentOrchestrationService');

jest.setTimeout(30000);

const createUser = async ({ email, role = 'recruiter', activeRole = 'employer' }) => User.create({
    name: email.split('@')[0],
    email,
    password: 'Password123!',
    role,
    activeRole,
    primaryRole: activeRole,
    hasCompletedProfile: true,
    hasSelectedRole: true,
});

describe('Financial Infrastructure', () => {
    let mongod;
    let employer;
    let worker;
    let job;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-financial-tests'));
    });

    beforeEach(async () => {
        await Promise.all(
            mongoose.connection.collections
                ? Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
                : []
        );

        jest.clearAllMocks();

        employer = await createUser({ email: 'employer@test.com', role: 'recruiter', activeRole: 'employer' });
        worker = await createUser({ email: 'worker@test.com', role: 'candidate', activeRole: 'worker' });

        const inserted = await Job.collection.insertOne({
            employerId: employer._id,
            title: 'Warehouse Associate',
            companyName: 'Hire Labs',
            salaryRange: '15000-25000',
            location: 'Hyderabad',
            requirements: ['Work ethic'],
            isOpen: true,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        job = { _id: inserted.insertedId };
    });

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongod.stop();
    });

    it('handles 100 concurrent escrow creations without negative balances', async () => {
        const totalEscrows = 100;

        const paymentRecords = await PaymentRecord.insertMany(
            Array.from({ length: totalEscrows }).map((_, index) => ({
                userId: employer._id,
                provider: 'stripe',
                intentType: 'escrow_funding',
                amount: 1000,
                currency: 'INR',
                status: 'captured',
                providerIntentId: `pi_${index}`,
            }))
        );

        await Promise.all(paymentRecords.map((record) => fundEscrow({
            actorId: employer._id,
            employerId: employer._id,
            workerId: worker._id,
            jobId: job._id,
            amount: 1000,
            currency: 'INR',
            paymentRecordId: record._id,
            metadata: {
                testCase: 'concurrent_funding',
            },
        })));

        const [escrowCount, employerWallet] = await Promise.all([
            Escrow.countDocuments({ employerId: employer._id }),
            Wallet.findOne({ userId: employer._id }),
        ]);

        expect(escrowCount).toBe(totalEscrows);
        expect(Number(employerWallet.balance || 0)).toBeGreaterThanOrEqual(0);
        expect(Number(employerWallet.pendingBalance || 0)).toBeGreaterThanOrEqual(0);
    });

    it('handles 50 simultaneous releases consistently with no double release', async () => {
        const totalEscrows = 50;

        const paymentRecords = await PaymentRecord.insertMany(
            Array.from({ length: totalEscrows }).map((_, index) => ({
                userId: employer._id,
                provider: 'stripe',
                intentType: 'escrow_funding',
                amount: 1000,
                currency: 'INR',
                status: 'captured',
                providerIntentId: `pi_release_${index}`,
            }))
        );

        const funded = await Promise.all(paymentRecords.map((record) => fundEscrow({
            actorId: employer._id,
            employerId: employer._id,
            workerId: worker._id,
            jobId: job._id,
            amount: 1000,
            currency: 'INR',
            paymentRecordId: record._id,
        })));

        await Promise.all(funded.map(({ escrow }) => releaseEscrow({
            escrowId: escrow._id,
            actorId: employer._id,
        })));

        const releasedCount = await Escrow.countDocuments({ status: 'released' });
        const workerWallet = await Wallet.findOne({ userId: worker._id });

        expect(releasedCount).toBe(totalEscrows);
        expect(Number(workerWallet.pendingBalance || 0)).toBeGreaterThan(0);
    });

    it('prevents duplicate release under race condition', async () => {
        const paymentRecord = await PaymentRecord.create({
            userId: employer._id,
            provider: 'stripe',
            intentType: 'escrow_funding',
            amount: 1200,
            currency: 'INR',
            status: 'captured',
            providerIntentId: 'pi_single_race',
        });

        const funded = await fundEscrow({
            actorId: employer._id,
            employerId: employer._id,
            workerId: worker._id,
            jobId: job._id,
            amount: 1200,
            currency: 'INR',
            paymentRecordId: paymentRecord._id,
        });

        const results = await Promise.allSettled([
            releaseEscrow({ escrowId: funded.escrow._id, actorId: employer._id }),
            releaseEscrow({ escrowId: funded.escrow._id, actorId: employer._id }),
        ]);

        const fulfilledCount = results.filter((entry) => entry.status === 'fulfilled').length;
        const rejectedCount = results.filter((entry) => entry.status === 'rejected').length;
        const reloadedEscrow = await Escrow.findById(funded.escrow._id);

        expect(fulfilledCount).toBe(1);
        expect(rejectedCount).toBe(1);
        expect(reloadedEscrow.status).toBe('released');
    });

    it('rejects webhook replay attacks for the same event id', async () => {
        paymentService.handleWebhook.mockResolvedValue({
            provider: 'stripe',
            eventId: 'evt_replay_1',
            eventType: 'payment_intent.succeeded',
            payload: {
                id: 'evt_replay_1',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_replay_1',
                        latest_charge: 'ch_replay_1',
                        payment_method: 'pm_replay_1',
                    },
                },
            },
        });

        const first = await processWebhook({
            provider: 'stripe',
            rawBody: Buffer.from('{}'),
            headers: { 'stripe-signature': 'sig_valid' },
        });

        const second = await processWebhook({
            provider: 'stripe',
            rawBody: Buffer.from('{}'),
            headers: { 'stripe-signature': 'sig_valid' },
        });

        const eventCount = await WebhookEventLog.countDocuments({ provider: 'stripe', eventId: 'evt_replay_1' });

        expect(first.duplicate).toBe(false);
        expect(second.duplicate).toBe(true);
        expect(eventCount).toBe(1);
    });

    it('flags rapid refund abuse attempts', async () => {
        paymentService.refundPayment.mockResolvedValue({
            provider: 'stripe',
            providerRefundId: 're_1',
            status: 'succeeded',
            raw: {},
        });

        const first = await PaymentRecord.create({
            userId: employer._id,
            provider: 'stripe',
            intentType: 'wallet_topup',
            amount: 700,
            currency: 'INR',
            status: 'captured',
            providerPaymentId: 'ch_refund_1',
            providerIntentId: 'pi_refund_1',
        });

        const second = await PaymentRecord.create({
            userId: employer._id,
            provider: 'stripe',
            intentType: 'wallet_topup',
            amount: 900,
            currency: 'INR',
            status: 'captured',
            providerPaymentId: 'ch_refund_2',
            providerIntentId: 'pi_refund_2',
        });

        await refundPaymentRecord({
            actorId: employer._id,
            paymentRecordId: first._id,
            reason: 'test_refund_1',
        });

        await refundPaymentRecord({
            actorId: employer._id,
            paymentRecordId: second._id,
            reason: 'test_refund_2',
        });

        const flags = await FraudFlag.find({ userId: employer._id, flagType: 'rapid_refund' });
        expect(flags.length).toBeGreaterThanOrEqual(1);
    });
});
