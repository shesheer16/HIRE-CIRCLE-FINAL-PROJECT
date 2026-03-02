const mongoose = require('mongoose');
const Wallet = require('../../models/Wallet');
const FinancialTransaction = require('../../models/FinancialTransaction');

const SYSTEM_PLATFORM_USER_ID = String(process.env.PLATFORM_FINANCE_USER_ID || '000000000000000000000001');
const MAX_FINANCIAL_AMOUNT = Number.parseFloat(process.env.MAX_FINANCIAL_AMOUNT || '10000000');

const normalizeAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Amount must be a positive number');
    }
    if (parsed > MAX_FINANCIAL_AMOUNT) {
        throw new Error('Amount exceeds maximum allowed threshold');
    }
    return Math.round(parsed * 100) / 100;
};

const ensureObjectId = (value) => {
    if (mongoose.Types.ObjectId.isValid(value)) return value;
    throw new Error('Invalid user id for wallet transaction');
};

const ensureWallet = async ({ userId, currency = 'INR', session = null }) => Wallet.findOneAndUpdate(
    { userId: ensureObjectId(userId) },
    {
        $setOnInsert: {
            userId,
            balance: 0,
            pendingBalance: 0,
            currency: String(currency || 'INR').toUpperCase(),
            kycStatus: 'not_started',
        },
        $set: {
            updatedAt: new Date(),
        },
    },
    {
        returnDocument: 'after',
        upsert: true,
        ...(session ? { session } : {}),
    }
);

const createTransaction = async ({
    userId,
    type,
    source,
    referenceId,
    amount,
    currency,
    status = 'completed',
    balanceBefore,
    balanceAfter,
    pendingBalanceBefore,
    pendingBalanceAfter,
    metadata = {},
    idempotencyKey = null,
    session = null,
}) => {
    const payload = {
        userId,
        type,
        source,
        referenceId: String(referenceId || ''),
        amount,
        currency: String(currency || 'INR').toUpperCase(),
        status,
        balanceBefore,
        balanceAfter,
        pendingBalanceBefore,
        pendingBalanceAfter,
        metadata,
        idempotencyKey,
    };

    if (!session) {
        return FinancialTransaction.create(payload);
    }

    const [row] = await FinancialTransaction.create([payload], { session });
    return row;
};

const creditAvailable = async ({ userId, amount, source, referenceId, currency = 'INR', metadata = {}, idempotencyKey = null, session = null }) => {
    const normalizedAmount = normalizeAmount(amount);
    await ensureWallet({ userId, currency, session });

    const wallet = await Wallet.findOneAndUpdate(
        { userId: ensureObjectId(userId) },
        {
            $inc: { balance: normalizedAmount },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after', ...(session ? { session } : {}) }
    );

    const balanceAfter = Number(wallet.balance || 0);
    const balanceBefore = Math.round((balanceAfter - normalizedAmount) * 100) / 100;

    const transaction = await createTransaction({
        userId,
        type: 'credit',
        source,
        referenceId,
        amount: normalizedAmount,
        currency,
        balanceBefore,
        balanceAfter,
        pendingBalanceBefore: Number(wallet.pendingBalance || 0),
        pendingBalanceAfter: Number(wallet.pendingBalance || 0),
        metadata,
        idempotencyKey,
        session,
    });

    return {
        wallet,
        transaction,
    };
};

const debitAvailable = async ({ userId, amount, source, referenceId, currency = 'INR', metadata = {}, idempotencyKey = null, session = null }) => {
    const normalizedAmount = normalizeAmount(amount);
    await ensureWallet({ userId, currency, session });

    const wallet = await Wallet.findOneAndUpdate(
        {
            userId: ensureObjectId(userId),
            balance: { $gte: normalizedAmount },
        },
        {
            $inc: { balance: -normalizedAmount },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after', ...(session ? { session } : {}) }
    );

    if (!wallet) {
        const error = new Error('Insufficient available wallet balance');
        error.statusCode = 400;
        throw error;
    }

    const balanceAfter = Number(wallet.balance || 0);
    const balanceBefore = Math.round((balanceAfter + normalizedAmount) * 100) / 100;

    const transaction = await createTransaction({
        userId,
        type: 'debit',
        source,
        referenceId,
        amount: normalizedAmount,
        currency,
        balanceBefore,
        balanceAfter,
        pendingBalanceBefore: Number(wallet.pendingBalance || 0),
        pendingBalanceAfter: Number(wallet.pendingBalance || 0),
        metadata,
        idempotencyKey,
        session,
    });

    return {
        wallet,
        transaction,
    };
};

const creditPending = async ({ userId, amount, source, referenceId, currency = 'INR', metadata = {}, idempotencyKey = null, session = null }) => {
    const normalizedAmount = normalizeAmount(amount);
    await ensureWallet({ userId, currency, session });

    const wallet = await Wallet.findOneAndUpdate(
        { userId: ensureObjectId(userId) },
        {
            $inc: { pendingBalance: normalizedAmount },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after', ...(session ? { session } : {}) }
    );

    const pendingAfter = Number(wallet.pendingBalance || 0);
    const pendingBefore = Math.round((pendingAfter - normalizedAmount) * 100) / 100;

    const transaction = await createTransaction({
        userId,
        type: 'credit',
        source,
        referenceId,
        amount: normalizedAmount,
        currency,
        balanceBefore: Number(wallet.balance || 0),
        balanceAfter: Number(wallet.balance || 0),
        pendingBalanceBefore: pendingBefore,
        pendingBalanceAfter: pendingAfter,
        metadata,
        idempotencyKey,
        session,
    });

    return {
        wallet,
        transaction,
    };
};

const debitPending = async ({ userId, amount, source, referenceId, currency = 'INR', metadata = {}, idempotencyKey = null, session = null }) => {
    const normalizedAmount = normalizeAmount(amount);
    await ensureWallet({ userId, currency, session });

    const wallet = await Wallet.findOneAndUpdate(
        {
            userId: ensureObjectId(userId),
            pendingBalance: { $gte: normalizedAmount },
        },
        {
            $inc: { pendingBalance: -normalizedAmount },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after', ...(session ? { session } : {}) }
    );

    if (!wallet) {
        const error = new Error('Insufficient pending wallet balance');
        error.statusCode = 400;
        throw error;
    }

    const pendingAfter = Number(wallet.pendingBalance || 0);
    const pendingBefore = Math.round((pendingAfter + normalizedAmount) * 100) / 100;

    const transaction = await createTransaction({
        userId,
        type: 'debit',
        source,
        referenceId,
        amount: normalizedAmount,
        currency,
        balanceBefore: Number(wallet.balance || 0),
        balanceAfter: Number(wallet.balance || 0),
        pendingBalanceBefore: pendingBefore,
        pendingBalanceAfter: pendingAfter,
        metadata,
        idempotencyKey,
        session,
    });

    return {
        wallet,
        transaction,
    };
};

const movePendingToAvailable = async ({ userId, amount, referenceId, currency = 'INR', metadata = {}, session = null }) => {
    const normalizedAmount = normalizeAmount(amount);

    const debit = await debitPending({
        userId,
        amount: normalizedAmount,
        source: 'settlement',
        referenceId,
        currency,
        metadata: {
            ...metadata,
            movement: 'pending_to_available',
        },
        session,
    });

    const credit = await creditAvailable({
        userId,
        amount: normalizedAmount,
        source: 'settlement',
        referenceId,
        currency,
        metadata: {
            ...metadata,
            movement: 'pending_to_available',
        },
        session,
    });

    return {
        debitTransaction: debit.transaction,
        creditTransaction: credit.transaction,
        wallet: credit.wallet,
    };
};

const getWalletSnapshot = async ({ userId, currency = 'INR', session = null }) => ensureWallet({ userId, currency, session });

const getTransactions = async ({ userId, limit = 100, offset = 0 }) => FinancialTransaction.find({ userId: ensureObjectId(userId) })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, Number(offset) || 0))
    .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
    .lean();

const getPlatformUserId = () => SYSTEM_PLATFORM_USER_ID;

module.exports = {
    ensureWallet,
    creditAvailable,
    debitAvailable,
    creditPending,
    debitPending,
    movePendingToAvailable,
    getWalletSnapshot,
    getTransactions,
    getPlatformUserId,
};
