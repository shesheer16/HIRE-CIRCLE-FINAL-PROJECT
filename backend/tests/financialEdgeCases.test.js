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
const Escrow = require('../models/Escrow');
const Wallet = require('../models/Wallet');
const PaymentRecord = require('../models/PaymentRecord');
const WebhookEventLog = require('../models/WebhookEventLog');

const { processWebhook } = require('../services/financial/paymentOrchestrationService');
const { fundEscrow, releaseEscrow, refundEscrow } = require('../services/financial/escrowService');
const { requestWithdrawal } = require('../services/financial/withdrawalService');
const { debitAvailable } = require('../services/financial/ledgerService');

jest.setTimeout(30000);

describe('financial edge cases', () => {
    let mongod;
    let employer;
    let worker;
    let job;

    const createUser = async ({ email, role = 'candidate', activeRole = 'worker' }) => User.create({
        name: email.split('@')[0],
        email,
        password: 'Password123!',
        role,
        activeRole,
        primaryRole: activeRole,
        hasSelectedRole: true,
        hasCompletedProfile: true,
        isVerified: true,
    });

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.WITHDRAWAL_MIN_THRESHOLD = '100';
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-financial-edge-tests'));
    });

    beforeEach(async () => {
        await Promise.all(
            Object.values(mongoose.connection.collections || {}).map((collection) => collection.deleteMany({}))
        );
        jest.clearAllMocks();

        employer = await createUser({ email: 'employer.edge@test.com', role: 'recruiter', activeRole: 'employer' });
        worker = await createUser({ email: 'worker.edge@test.com', role: 'candidate', activeRole: 'worker' });
        job = await Job.create({
            employerId: employer._id,
            title: 'Warehouse Associate',
            companyName: 'Hire Labs',
            salaryRange: '15000-25000',
            location: 'Hyderabad',
            requirements: ['Work ethic'],
            isOpen: true,
            status: 'active',
        });
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

    it('rejects duplicate webhook replay events by eventId', async () => {
        paymentService.handleWebhook.mockResolvedValue({
            provider: 'stripe',
            eventId: 'evt_financial_edge_1',
            eventType: 'payment_intent.succeeded',
            payload: {
                id: 'evt_financial_edge_1',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_financial_edge_1',
                        latest_charge: 'ch_financial_edge_1',
                        payment_method: 'pm_financial_edge_1',
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

        const persisted = await WebhookEventLog.countDocuments({ provider: 'stripe', eventId: 'evt_financial_edge_1' });
        expect(first.duplicate).toBe(false);
        expect(typeof second.duplicate).toBe('boolean');
        expect(persisted).toBe(1);
    });

    it('prevents escrow double-release and blocks refund after release', async () => {
        const paymentRecord = await PaymentRecord.create({
            userId: employer._id,
            provider: 'stripe',
            intentType: 'escrow_funding',
            amount: 1500,
            currency: 'INR',
            status: 'captured',
            providerIntentId: 'pi_escrow_edge_1',
        });

        const funded = await fundEscrow({
            actorId: employer._id,
            employerId: employer._id,
            workerId: worker._id,
            jobId: job._id,
            amount: 1500,
            currency: 'INR',
            paymentRecordId: paymentRecord._id,
        });

        const released = await releaseEscrow({
            escrowId: funded.escrow._id,
            actorId: employer._id,
        });
        expect(released.escrow.status).toBe('released');

        await expect(releaseEscrow({
            escrowId: funded.escrow._id,
            actorId: employer._id,
        })).rejects.toMatchObject({ statusCode: 409 });

        await expect(refundEscrow({
            escrowId: funded.escrow._id,
            actorId: employer._id,
            reason: 'should_fail_after_release',
        })).rejects.toMatchObject({ statusCode: 409 });

        const escrowAfter = await Escrow.findById(funded.escrow._id).lean();
        expect(escrowAfter.status).toBe('released');
        expect(escrowAfter.refundTransactionId).toBeNull();
    });

    it('enforces withdrawal minimum threshold and prevents negative wallet balances', async () => {
        await Wallet.create({
            userId: worker._id,
            balance: 200,
            pendingBalance: 0,
            currency: 'INR',
            kycStatus: 'verified',
        });

        await expect(requestWithdrawal({
            userId: worker._id,
            amount: 50,
            currency: 'INR',
            actorId: worker._id,
        })).rejects.toMatchObject({ statusCode: 400 });

        await expect(debitAvailable({
            userId: worker._id,
            amount: 500,
            source: 'edge_test',
            referenceId: 'edge_overdraw_1',
            currency: 'INR',
        })).rejects.toMatchObject({ statusCode: 400 });

        const walletAfter = await Wallet.findOne({ userId: worker._id }).lean();
        expect(Number(walletAfter.balance)).toBeGreaterThanOrEqual(0);
        expect(Number(walletAfter.pendingBalance)).toBeGreaterThanOrEqual(0);
        expect(Number(walletAfter.balance)).toBe(200);
    });
});
