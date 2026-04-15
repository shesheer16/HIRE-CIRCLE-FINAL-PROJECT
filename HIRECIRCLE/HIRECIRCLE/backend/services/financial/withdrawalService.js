const mongoose = require('mongoose');
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Wallet = require('../../models/Wallet');
const { debitAvailable, creditPending, debitPending, creditAvailable } = require('./ledgerService');
const { logFinancialAction } = require('./auditLogService');

const MIN_WITHDRAWAL_AMOUNT = Number(process.env.WITHDRAWAL_MIN_THRESHOLD || 100);
const FINANCIAL_TRANSACTION_OPTIONS = {
    readPreference: 'primary',
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
};
const isTransactionUnsupportedError = (error) => /transaction numbers are only allowed|replica set|transaction support/i.test(String(error?.message || ''));

const normalizeAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid withdrawal amount');
    }
    return Math.round(parsed * 100) / 100;
};

const withFinancialTransaction = async (handler) => {
    const session = await mongoose.startSession();
    try {
        try {
            let result = null;
            await session.withTransaction(async () => {
                result = await handler(session);
            }, FINANCIAL_TRANSACTION_OPTIONS);
            return result;
        } catch (error) {
            if (!isTransactionUnsupportedError(error)) {
                throw error;
            }

            // Local or standalone Mongo fallback: preserve behavior when transactions are unavailable.
            return handler(null);
        }
    } finally {
        await session.endSession();
    }
};

const assertKycAndBalance = async ({ userId, amount, session = null }) => {
    const wallet = await Wallet.findOne({ userId }, null, session ? { session } : undefined);
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

const requestWithdrawal = async ({
    userId,
    amount,
    currency = 'INR',
    actorId,
    metadata = {},
    idempotencyKey = null,
    requestBodyHash = null,
}) => {
    const normalizedAmount = normalizeAmount(amount);

    if (normalizedAmount < MIN_WITHDRAWAL_AMOUNT) {
        const error = new Error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT}`);
        error.statusCode = 400;
        throw error;
    }

    if (!idempotencyKey || !requestBodyHash) {
        const error = new Error('Idempotency key and request hash are required');
        error.statusCode = 400;
        throw error;
    }

    let withdrawal = null;
    try {
        withdrawal = await withFinancialTransaction(async (session) => {
            const wallet = await assertKycAndBalance({ userId, amount: normalizedAmount, session });

            const debit = await debitAvailable({
                userId,
                amount: normalizedAmount,
                source: 'withdrawal_request',
                referenceId: `withdrawal_request:${String(idempotencyKey)}`,
                currency,
                metadata,
                idempotencyKey: `${String(idempotencyKey)}:debit`,
                session,
            });

            const hold = await creditPending({
                userId,
                amount: normalizedAmount,
                source: 'withdrawal_request',
                referenceId: String(debit.transaction._id),
                currency,
                metadata,
                idempotencyKey: `${String(idempotencyKey)}:hold`,
                session,
            });

            const [created] = await WithdrawalRequest.create([{
                userId,
                amount: normalizedAmount,
                currency,
                status: 'requested',
                requestedAt: new Date(),
                idempotencyKey: String(idempotencyKey),
                requestBodyHash: String(requestBodyHash),
                metadata: {
                    ...metadata,
                    debitTransactionId: String(debit.transaction._id),
                    holdTransactionId: String(hold.transaction._id),
                    walletSnapshot: {
                        balance: wallet.balance,
                        pendingBalance: wallet.pendingBalance,
                    },
                },
            }], { session });

            return created;
        });
    } catch (error) {
        if (Number(error?.code) === 11000) {
            const existing = await WithdrawalRequest.findOne({ idempotencyKey: String(idempotencyKey) });
            if (existing) {
                return existing;
            }
            const duplicateError = new Error('Duplicate withdrawal idempotency key');
            duplicateError.statusCode = 409;
            throw duplicateError;
        }
        throw error;
    }

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
    const result = await withFinancialTransaction(async (session) => {
        const existing = await WithdrawalRequest.findById(withdrawalId, null, { session });
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
            { returnDocument: 'after', session }
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
            idempotencyKey: `withdrawal_approve:${String(withdrawal._id)}`,
            session,
        });

        return {
            existing,
            withdrawal,
        };
    });

    await logFinancialAction({
        actorId,
        actionType: 'withdrawal.processed',
        referenceId: String(result.withdrawal._id),
        previousState: result.existing.toObject(),
        newState: {
            status: result.withdrawal.status,
            processedAt: result.withdrawal.processedAt,
            payoutReferenceId: result.withdrawal.payoutReferenceId,
        },
    });

    return result.withdrawal;
};

const rejectWithdrawal = async ({ withdrawalId, actorId, reason = 'rejected_by_admin' }) => {
    const result = await withFinancialTransaction(async (session) => {
        const existing = await WithdrawalRequest.findById(withdrawalId, null, { session });
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
            { returnDocument: 'after', session }
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
            idempotencyKey: `withdrawal_reject:${String(withdrawal._id)}:debit`,
            session,
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
            idempotencyKey: `withdrawal_reject:${String(withdrawal._id)}:credit`,
            session,
        });

        return {
            existing,
            withdrawal,
        };
    });

    await logFinancialAction({
        actorId,
        actionType: 'withdrawal.rejected',
        referenceId: String(result.withdrawal._id),
        previousState: result.existing.toObject(),
        newState: {
            status: result.withdrawal.status,
            rejectionReason: result.withdrawal.rejectionReason,
        },
    });

    return result.withdrawal;
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
