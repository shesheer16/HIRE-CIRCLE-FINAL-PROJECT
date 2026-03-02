const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Wallet = require('../../models/Wallet');
const { debitAvailable, creditPending, debitPending, creditAvailable } = require('./ledgerService');
const { logFinancialAction } = require('./auditLogService');

const MIN_WITHDRAWAL_AMOUNT = Number(process.env.WITHDRAWAL_MIN_THRESHOLD || 100);

const normalizeAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid withdrawal amount');
    }
    return Math.round(parsed * 100) / 100;
};

const assertKycAndBalance = async ({ userId, amount }) => {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
        const error = new Error('Wallet not found');
        error.statusCode = 404;
        throw error;
    }

    if (wallet.kycStatus !== 'verified') {
        const error = new Error('KYC verification is required before withdrawal');
        error.statusCode = 403;
        throw error;
    }

    if (Number(wallet.balance || 0) < amount) {
        const error = new Error('Insufficient wallet balance for withdrawal');
        error.statusCode = 400;
        throw error;
    }

    return wallet;
};

const requestWithdrawal = async ({ userId, amount, currency = 'INR', actorId, metadata = {} }) => {
    const normalizedAmount = normalizeAmount(amount);

    if (normalizedAmount < MIN_WITHDRAWAL_AMOUNT) {
        const error = new Error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT}`);
        error.statusCode = 400;
        throw error;
    }

    const wallet = await assertKycAndBalance({ userId, amount: normalizedAmount });

    const debit = await debitAvailable({
        userId,
        amount: normalizedAmount,
        source: 'withdrawal_request',
        referenceId: `withdrawal_request:${String(userId)}:${Date.now()}`,
        currency,
        metadata,
    });

    const hold = await creditPending({
        userId,
        amount: normalizedAmount,
        source: 'withdrawal_request',
        referenceId: String(debit.transaction._id),
        currency,
        metadata,
    });

    const withdrawal = await WithdrawalRequest.create({
        userId,
        amount: normalizedAmount,
        currency,
        status: 'requested',
        requestedAt: new Date(),
        metadata: {
            ...metadata,
            debitTransactionId: String(debit.transaction._id),
            holdTransactionId: String(hold.transaction._id),
            walletSnapshot: {
                balance: wallet.balance,
                pendingBalance: wallet.pendingBalance,
            },
        },
    });

    await logFinancialAction({
        actorId: actorId || userId,
        actionType: 'withdrawal.requested',
        referenceId: String(withdrawal._id),
        previousState: {},
        newState: {
            status: withdrawal.status,
            amount: withdrawal.amount,
        },
    });

    return withdrawal;
};

const approveWithdrawal = async ({ withdrawalId, actorId, payoutReferenceId = null }) => {
    const existing = await WithdrawalRequest.findById(withdrawalId);
    if (!existing) {
        const error = new Error('Withdrawal request not found');
        error.statusCode = 404;
        throw error;
    }

    if (existing.status !== 'requested' && existing.status !== 'approved') {
        const error = new Error('Withdrawal request is not pending approval');
        error.statusCode = 409;
        throw error;
    }

    const withdrawal = await WithdrawalRequest.findOneAndUpdate(
        { _id: withdrawalId, status: { $in: ['requested', 'approved'] } },
        {
            $set: {
                status: 'processed',
                processedAt: new Date(),
                processedBy: actorId,
                payoutReferenceId: payoutReferenceId || null,
            },
        },
        { returnDocument: 'after' }
    );

    if (!withdrawal) {
        const error = new Error('Withdrawal approval race detected');
        error.statusCode = 409;
        throw error;
    }

    await debitPending({
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        source: 'withdrawal_processed',
        referenceId: String(withdrawal._id),
        currency: withdrawal.currency,
        metadata: {
            payoutReferenceId: payoutReferenceId || null,
        },
    });

    await logFinancialAction({
        actorId,
        actionType: 'withdrawal.processed',
        referenceId: String(withdrawal._id),
        previousState: existing.toObject(),
        newState: {
            status: withdrawal.status,
            processedAt: withdrawal.processedAt,
            payoutReferenceId: withdrawal.payoutReferenceId,
        },
    });

    return withdrawal;
};

const rejectWithdrawal = async ({ withdrawalId, actorId, reason = 'rejected_by_admin' }) => {
    const existing = await WithdrawalRequest.findById(withdrawalId);
    if (!existing) {
        const error = new Error('Withdrawal request not found');
        error.statusCode = 404;
        throw error;
    }

    if (existing.status !== 'requested' && existing.status !== 'approved') {
        const error = new Error('Withdrawal request is not pending approval');
        error.statusCode = 409;
        throw error;
    }

    const withdrawal = await WithdrawalRequest.findOneAndUpdate(
        { _id: withdrawalId, status: { $in: ['requested', 'approved'] } },
        {
            $set: {
                status: 'rejected',
                processedAt: new Date(),
                processedBy: actorId,
                rejectionReason: reason,
            },
        },
        { returnDocument: 'after' }
    );

    if (!withdrawal) {
        const error = new Error('Withdrawal rejection race detected');
        error.statusCode = 409;
        throw error;
    }

    await debitPending({
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        source: 'withdrawal_reversal',
        referenceId: String(withdrawal._id),
        currency: withdrawal.currency,
        metadata: {
            reason,
        },
    });

    await creditAvailable({
        userId: withdrawal.userId,
        amount: withdrawal.amount,
        source: 'withdrawal_reversal',
        referenceId: String(withdrawal._id),
        currency: withdrawal.currency,
        metadata: {
            reason,
        },
    });

    await logFinancialAction({
        actorId,
        actionType: 'withdrawal.rejected',
        referenceId: String(withdrawal._id),
        previousState: existing.toObject(),
        newState: {
            status: withdrawal.status,
            rejectionReason: withdrawal.rejectionReason,
        },
    });

    return withdrawal;
};

const listWithdrawals = async ({ userId = null, status = null, limit = 100 }) => {
    const query = {};
    if (userId) query.userId = userId;
    if (status) query.status = status;

    return WithdrawalRequest.find(query)
        .sort({ requestedAt: -1 })
        .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
        .lean();
};

module.exports = {
    requestWithdrawal,
    approveWithdrawal,
    rejectWithdrawal,
    listWithdrawals,
};
