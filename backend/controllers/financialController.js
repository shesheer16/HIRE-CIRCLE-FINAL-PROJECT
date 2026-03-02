const FinancialAuditLog = require('../models/FinancialAuditLog');
const CommissionConfig = require('../models/CommissionConfig');
const User = require('../models/userModel');
const { executeIdempotent } = require('../services/financial/idempotentRequestExecutor');
const {
    createPaymentIntentRecord,
    verifyPaymentRecord,
    processWebhook,
    refundPaymentRecord,
} = require('../services/financial/paymentOrchestrationService');
const {
    createSubscriptionCheckoutSession,
    getSubscriptionState,
    cancelSubscription,
    enforceSubscriptionExpiry,
} = require('../services/financial/subscriptionBillingService');
const { fundEscrow, releaseEscrow, refundEscrow, getEscrowById } = require('../services/financial/escrowService');
const { getWallet, getWalletTransactions, settlePendingBalance, updateWalletKycStatus } = require('../services/financial/walletService');
const {
    requestWithdrawal,
    approveWithdrawal,
    rejectWithdrawal,
    listWithdrawals,
} = require('../services/financial/withdrawalService');
const { raiseDispute, resolveDispute, listDisputes } = require('../services/financial/disputeService');
const { listFraudFlags } = require('../services/financial/fraudDetectionService');

const handleError = (res, error, fallbackMessage) => {
    const statusCode = Number(error?.statusCode || 500);
    if (statusCode >= 500) {
        console.warn(`[financial-controller] ${error?.message || fallbackMessage}`);
    }
    return res.status(statusCode).json({ message: error?.message || fallbackMessage });
};

const createPaymentIntent = async (req, res) => {
    try {
        const payload = req.body || {};
        const result = await executeIdempotent({
            req,
            scope: 'payment:create_intent',
            payload,
            handler: async ({ idempotencyKey }) => {
                const { provider, intentType, amount, currency = 'INR', referenceId = null, metadata = {} } = payload;

                const created = await createPaymentIntentRecord({
                    userId: req.user._id,
                    provider,
                    intentType,
                    amount,
                    currency,
                    referenceId,
                    metadata,
                    idempotencyKey,
                });

                return {
                    paymentRecordId: created.paymentRecord._id,
                    provider: created.paymentRecord.provider,
                    intentType: created.paymentRecord.intentType,
                    amount: created.paymentRecord.amount,
                    currency: created.paymentRecord.currency,
                    status: created.paymentRecord.status,
                    providerIntentId: created.providerResponse.providerIntentId,
                    providerOrderId: created.providerResponse.providerOrderId,
                    clientSecret: created.providerResponse.clientSecret || null,
                };
            },
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        return handleError(res, error, 'Failed to create payment intent');
    }
};

const verifyPayment = async (req, res) => {
    try {
        const payload = req.body || {};
        const result = await executeIdempotent({
            req,
            scope: 'payment:verify',
            payload,
            handler: async () => {
                const verified = await verifyPaymentRecord({
                    userId: req.user._id,
                    paymentRecordId: payload.paymentRecordId,
                    provider: payload.provider,
                    providerIntentId: payload.providerIntentId,
                    providerOrderId: payload.providerOrderId,
                    providerPaymentId: payload.providerPaymentId,
                    signature: payload.signature,
                });

                return {
                    paymentRecordId: verified.paymentRecord._id,
                    status: verified.paymentRecord.status,
                    providerPaymentId: verified.paymentRecord.providerPaymentId,
                    providerIntentId: verified.paymentRecord.providerIntentId,
                    isVerified: verified.verification.isVerified,
                };
            },
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        return handleError(res, error, 'Failed to verify payment');
    }
};

const refundPayment = async (req, res) => {
    try {
        const payload = req.body || {};
        const result = await executeIdempotent({
            req,
            scope: 'payment:refund',
            payload,
            handler: async () => {
                const refunded = await refundPaymentRecord({
                    actorId: req.user._id,
                    paymentRecordId: payload.paymentRecordId,
                    amount: payload.amount,
                    reason: payload.reason,
                });

                return {
                    paymentRecordId: refunded.paymentRecord._id,
                    status: refunded.paymentRecord.status,
                    alreadyRefunded: refunded.alreadyRefunded,
                    providerRefundId: refunded.providerRefund?.providerRefundId || null,
                };
            },
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        return handleError(res, error, 'Failed to refund payment');
    }
};

const paymentWebhook = async (req, res) => {
    try {
        const provider = String(req.params.provider || req.query.provider || 'stripe').trim().toLowerCase();
        const webhookResult = await processWebhook({
            provider,
            rawBody: req.body,
            headers: req.headers,
        });

        return res.status(200).json({
            received: true,
            duplicate: webhookResult.duplicate,
            eventId: webhookResult.eventId,
            eventType: webhookResult.eventType,
        });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Webhook processing failed' });
    }
};

const createSubscriptionCheckout = async (req, res) => {
    try {
        const payload = req.body || {};
        const user = await User.findById(req.user._id).select('email');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const session = await createSubscriptionCheckoutSession({
            user,
            planType: payload.planType || 'pro',
            successUrl: payload.successUrl,
            cancelUrl: payload.cancelUrl,
        });

        return res.status(200).json(session);
    } catch (error) {
        return handleError(res, error, 'Failed to start subscription checkout');
    }
};

const getMySubscription = async (req, res) => {
    try {
        await enforceSubscriptionExpiry();
        const subscription = await getSubscriptionState({ userId: req.user._id });
        return res.status(200).json({ subscription });
    } catch (error) {
        return handleError(res, error, 'Failed to load subscription state');
    }
};

const cancelMySubscription = async (req, res) => {
    try {
        const subscription = await cancelSubscription({
            userId: req.user._id,
            actorId: req.user._id,
        });

        return res.status(200).json({ subscription });
    } catch (error) {
        return handleError(res, error, 'Failed to cancel subscription');
    }
};

const fundEscrowController = async (req, res) => {
    try {
        const payload = req.body || {};
        const result = await executeIdempotent({
            req,
            scope: 'escrow:fund',
            payload,
            handler: async () => {
                const funded = await fundEscrow({
                    actorId: req.user._id,
                    employerId: req.user._id,
                    workerId: payload.workerId,
                    jobId: payload.jobId,
                    amount: payload.amount,
                    currency: payload.currency || 'INR',
                    paymentRecordId: payload.paymentRecordId,
                    metadata: payload.metadata || {},
                });

                return {
                    escrowId: funded.escrow._id,
                    status: funded.escrow.status,
                    created: funded.created,
                };
            },
        });

        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        return handleError(res, error, 'Failed to fund escrow');
    }
};

const releaseEscrowController = async (req, res) => {
    try {
        const released = await releaseEscrow({
            escrowId: req.params.escrowId,
            actorId: req.user._id,
            allowDisputed: false,
            metadata: req.body?.metadata || {},
        });

        return res.status(200).json({
            escrowId: released.escrow._id,
            status: released.escrow.status,
            commission: released.commission,
        });
    } catch (error) {
        return handleError(res, error, 'Failed to release escrow');
    }
};

const refundEscrowController = async (req, res) => {
    try {
        const refunded = await refundEscrow({
            escrowId: req.params.escrowId,
            actorId: req.user._id,
            allowDisputed: false,
            reason: req.body?.reason || 'manual_refund',
        });

        return res.status(200).json({
            escrowId: refunded.escrow._id,
            status: refunded.escrow.status,
        });
    } catch (error) {
        return handleError(res, error, 'Failed to refund escrow');
    }
};

const getEscrowDetail = async (req, res) => {
    try {
        const escrow = await getEscrowById({
            escrowId: req.params.escrowId,
            actorId: req.user?._id,
        });
        if (!escrow) {
            return res.status(404).json({ message: 'Escrow not found' });
        }
        return res.status(200).json({ escrow });
    } catch (error) {
        return handleError(res, error, 'Failed to get escrow details');
    }
};

const getMyWallet = async (req, res) => {
    try {
        const wallet = await getWallet({ userId: req.user._id });
        const walletPayload = wallet?.toObject ? wallet.toObject() : (wallet || {});
        const sanitizedWallet = {
            ...walletPayload,
            balance: Math.max(0, Number(walletPayload.balance || 0)),
            pendingBalance: Math.max(0, Number(walletPayload.pendingBalance || 0)),
        };
        return res.status(200).json({ wallet: sanitizedWallet });
    } catch (error) {
        return handleError(res, error, 'Failed to load wallet');
    }
};

const getMyTransactions = async (req, res) => {
    try {
        const transactions = await getWalletTransactions({
            userId: req.user._id,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.status(200).json({ transactions });
    } catch (error) {
        return handleError(res, error, 'Failed to load transactions');
    }
};

const settlePendingWallet = async (req, res) => {
    try {
        const result = await settlePendingBalance({
            userId: req.params.userId,
            amount: req.body?.amount,
            actorId: req.user._id,
        });
        return res.status(200).json({ result });
    } catch (error) {
        return handleError(res, error, 'Failed to settle pending balance');
    }
};

const updateWalletKycController = async (req, res) => {
    try {
        const wallet = await updateWalletKycStatus({
            userId: req.params.userId,
            kycStatus: req.body?.kycStatus,
        });

        return res.status(200).json({ wallet });
    } catch (error) {
        return handleError(res, error, 'Failed to update wallet KYC status');
    }
};

const requestWithdrawalController = async (req, res) => {
    try {
        const withdrawal = await requestWithdrawal({
            userId: req.user._id,
            amount: req.body?.amount,
            currency: req.body?.currency || 'INR',
            actorId: req.user._id,
            metadata: req.body?.metadata || {},
        });

        return res.status(200).json({ withdrawal });
    } catch (error) {
        return handleError(res, error, 'Failed to request withdrawal');
    }
};

const listMyWithdrawals = async (req, res) => {
    try {
        const withdrawals = await listWithdrawals({
            userId: req.user._id,
            status: req.query.status || null,
            limit: req.query.limit,
        });
        return res.status(200).json({ withdrawals });
    } catch (error) {
        return handleError(res, error, 'Failed to list withdrawals');
    }
};

const listAllWithdrawals = async (req, res) => {
    try {
        const withdrawals = await listWithdrawals({
            userId: null,
            status: req.query.status || null,
            limit: req.query.limit,
        });
        return res.status(200).json({ withdrawals });
    } catch (error) {
        return handleError(res, error, 'Failed to list withdrawals');
    }
};

const approveWithdrawalController = async (req, res) => {
    try {
        const withdrawal = await approveWithdrawal({
            withdrawalId: req.params.withdrawalId,
            actorId: req.user._id,
            payoutReferenceId: req.body?.payoutReferenceId || null,
        });

        return res.status(200).json({ withdrawal });
    } catch (error) {
        return handleError(res, error, 'Failed to approve withdrawal');
    }
};

const rejectWithdrawalController = async (req, res) => {
    try {
        const withdrawal = await rejectWithdrawal({
            withdrawalId: req.params.withdrawalId,
            actorId: req.user._id,
            reason: req.body?.reason || 'rejected_by_admin',
        });

        return res.status(200).json({ withdrawal });
    } catch (error) {
        return handleError(res, error, 'Failed to reject withdrawal');
    }
};

const raiseDisputeController = async (req, res) => {
    try {
        const result = await raiseDispute({
            escrowId: req.body?.escrowId,
            raisedBy: req.user._id,
            reason: req.body?.reason,
            metadata: req.body?.metadata || {},
        });

        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error, 'Failed to raise dispute');
    }
};

const resolveDisputeController = async (req, res) => {
    try {
        const result = await resolveDispute({
            disputeId: req.params.disputeId,
            actorId: req.user._id,
            adminDecision: req.body?.adminDecision,
            resolutionNote: req.body?.resolutionNote,
            splitRatio: req.body?.splitRatio,
        });

        return res.status(200).json(result);
    } catch (error) {
        return handleError(res, error, 'Failed to resolve dispute');
    }
};

const listDisputesController = async (req, res) => {
    try {
        const disputes = await listDisputes({
            status: req.query.status || null,
            limit: req.query.limit,
        });

        return res.status(200).json({ disputes });
    } catch (error) {
        return handleError(res, error, 'Failed to list disputes');
    }
};

const listFraudFlagsController = async (req, res) => {
    try {
        const flags = await listFraudFlags({
            status: req.query.status || null,
            limit: req.query.limit,
        });

        return res.status(200).json({ flags });
    } catch (error) {
        return handleError(res, error, 'Failed to list fraud flags');
    }
};

const listAuditLogsController = async (req, res) => {
    try {
        const query = {};
        if (req.query.actorId) query.actorId = req.query.actorId;
        if (req.query.actionType) query.actionType = req.query.actionType;
        if (req.query.referenceId) query.referenceId = String(req.query.referenceId);

        const logs = await FinancialAuditLog.find(query)
            .sort({ timestamp: -1 })
            .limit(Math.max(1, Math.min(250, Number(req.query.limit) || 100)))
            .lean();

        return res.status(200).json({ logs });
    } catch (error) {
        return handleError(res, error, 'Failed to list audit logs');
    }
};

const getCommissionConfigController = async (_req, res) => {
    try {
        const config = await CommissionConfig.findOne({ isActive: true }).sort({ effectiveFrom: -1 }).lean();
        return res.status(200).json({ config });
    } catch (error) {
        return handleError(res, error, 'Failed to load commission config');
    }
};

const upsertCommissionConfigController = async (req, res) => {
    try {
        const payload = req.body || {};

        await CommissionConfig.updateMany({ isActive: true }, { $set: { isActive: false } });

        const config = await CommissionConfig.create({
            percentage: payload.percentage,
            flatFee: payload.flatFee,
            planTypeBased: payload.planTypeBased || {},
            isActive: true,
            effectiveFrom: new Date(),
            metadata: payload.metadata || {},
        });

        return res.status(200).json({ config });
    } catch (error) {
        return handleError(res, error, 'Failed to update commission config');
    }
};

module.exports = {
    createPaymentIntent,
    verifyPayment,
    refundPayment,
    paymentWebhook,
    createSubscriptionCheckout,
    getMySubscription,
    cancelMySubscription,
    fundEscrowController,
    releaseEscrowController,
    refundEscrowController,
    getEscrowDetail,
    getMyWallet,
    getMyTransactions,
    settlePendingWallet,
    updateWalletKycController,
    requestWithdrawalController,
    listMyWithdrawals,
    listAllWithdrawals,
    approveWithdrawalController,
    rejectWithdrawalController,
    raiseDisputeController,
    resolveDisputeController,
    listDisputesController,
    listFraudFlagsController,
    listAuditLogsController,
    getCommissionConfigController,
    upsertCommissionConfigController,
};
