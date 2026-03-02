const Job = require('../../models/Job');
const User = require('../../models/userModel');
const Escrow = require('../../models/Escrow');
const PaymentRecord = require('../../models/PaymentRecord');
const {
    creditAvailable,
    debitAvailable,
    creditPending,
    getPlatformUserId,
} = require('./ledgerService');
const { calculateCommission } = require('./commissionService');
const { logFinancialAction } = require('./auditLogService');
const { detectEscrowAbusePattern } = require('./fraudDetectionService');
const MAX_FINANCIAL_AMOUNT = Number.parseFloat(process.env.MAX_FINANCIAL_AMOUNT || '10000000');

const normalizeAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid amount');
    }
    if (parsed > MAX_FINANCIAL_AMOUNT) {
        throw new Error('Amount exceeds maximum allowed threshold');
    }
    return Math.round(parsed * 100) / 100;
};

const normalizeCurrency = (currency = 'INR') => String(currency || 'INR').trim().toUpperCase();

const getAdminStatus = async (actorId) => {
    if (!actorId) return false;
    const actor = await User.findById(actorId).select('isAdmin').lean();
    return Boolean(actor?.isAdmin);
};

const assertEscrowReadAccess = async ({ escrow, actorId }) => {
    if (!actorId) {
        const error = new Error('Authentication required');
        error.statusCode = 401;
        throw error;
    }

    const actor = String(actorId);
    if (actor === String(escrow.employerId) || actor === String(escrow.workerId)) {
        return { isAdmin: false };
    }

    const isAdmin = await getAdminStatus(actorId);
    if (isAdmin) return { isAdmin: true };

    const error = new Error('Not authorized to access this escrow');
    error.statusCode = 403;
    throw error;
};

const assertEscrowMutationAccess = async ({ escrow, actorId, allowDisputed = false }) => {
    if (!actorId) {
        const error = new Error('Authentication required');
        error.statusCode = 401;
        throw error;
    }

    const actor = String(actorId);
    const isEmployer = actor === String(escrow.employerId);
    const isAdmin = await getAdminStatus(actorId);

    if (!isEmployer && !isAdmin) {
        const error = new Error('Not authorized to modify this escrow');
        error.statusCode = 403;
        throw error;
    }

    if (allowDisputed && !isAdmin) {
        const error = new Error('Only admins can override disputed escrow state');
        error.statusCode = 403;
        throw error;
    }

    return { isAdmin };
};

const assertJobOwnership = async ({ employerId, jobId }) => {
    const job = await Job.findById(jobId).lean();
    if (!job) {
        const error = new Error('Job not found');
        error.statusCode = 404;
        throw error;
    }

    if (String(job.employerId) !== String(employerId)) {
        const error = new Error('Job does not belong to employer');
        error.statusCode = 403;
        throw error;
    }

    return job;
};

const assertCapturedPaymentForEscrow = async ({ userId, paymentRecordId, amount, currency }) => {
    const record = await PaymentRecord.findById(paymentRecordId);
    if (!record) {
        const error = new Error('Payment record not found for escrow funding');
        error.statusCode = 404;
        throw error;
    }

    if (String(record.userId) !== String(userId)) {
        const error = new Error('Payment record does not belong to employer');
        error.statusCode = 403;
        throw error;
    }

    if (record.status !== 'captured') {
        const error = new Error('Payment record is not captured');
        error.statusCode = 400;
        throw error;
    }

    if (Math.abs(Number(record.amount || 0) - Number(amount || 0)) > 0.0001) {
        const error = new Error('Escrow funding amount does not match captured payment');
        error.statusCode = 400;
        throw error;
    }

    if (String(record.currency || '').toUpperCase() !== String(currency || '').toUpperCase()) {
        const error = new Error('Escrow funding currency does not match captured payment');
        error.statusCode = 400;
        throw error;
    }

    return record;
};

const fundEscrow = async ({
    actorId,
    employerId,
    workerId,
    jobId,
    amount,
    currency = 'INR',
    paymentRecordId,
    metadata = {},
}) => {
    const normalizedAmount = normalizeAmount(amount);
    const normalizedCurrency = normalizeCurrency(currency);
    const isAdminActor = await getAdminStatus(actorId);
    if (String(actorId) !== String(employerId) && !isAdminActor) {
        const error = new Error('Only escrow owner or admin can fund escrow');
        error.statusCode = 403;
        throw error;
    }

    await assertJobOwnership({ employerId, jobId });

    const paymentRecord = await assertCapturedPaymentForEscrow({
        userId: employerId,
        paymentRecordId,
        amount: normalizedAmount,
        currency: normalizedCurrency,
    });

    const existing = await Escrow.findOne({
        paymentProvider: paymentRecord.provider,
        paymentReferenceId: String(paymentRecord._id),
    });

    if (existing) {
        return {
            escrow: existing,
            created: false,
        };
    }

    const escrow = await Escrow.create({
        jobId,
        employerId,
        workerId,
        amount: normalizedAmount,
        currency: normalizedCurrency,
        status: 'funded',
        paymentProvider: paymentRecord.provider,
        paymentReferenceId: String(paymentRecord._id),
        createdAt: new Date(),
        metadata,
    });

    await creditAvailable({
        userId: employerId,
        amount: normalizedAmount,
        source: 'job_payment',
        referenceId: String(paymentRecord._id),
        currency: normalizedCurrency,
        metadata: {
            escrowId: String(escrow._id),
            provider: paymentRecord.provider,
        },
    });

    const locked = await debitAvailable({
        userId: employerId,
        amount: normalizedAmount,
        source: 'escrow_fund',
        referenceId: String(escrow._id),
        currency: normalizedCurrency,
        metadata: {
            paymentRecordId: String(paymentRecord._id),
        },
    });

    escrow.fundTransactionId = locked.transaction._id;
    await escrow.save();

    await logFinancialAction({
        actorId,
        actionType: 'escrow.funded',
        referenceId: String(escrow._id),
        previousState: {},
        newState: {
            status: escrow.status,
            amount: escrow.amount,
            employerId: String(escrow.employerId),
            workerId: String(escrow.workerId),
        },
        metadata: {
            paymentRecordId: String(paymentRecord._id),
        },
    });

    return {
        escrow,
        created: true,
    };
};

const releaseEscrow = async ({ escrowId, actorId, allowDisputed = false, metadata = {} }) => {
    const existing = await Escrow.findById(escrowId);
    if (!existing) {
        const error = new Error('Escrow not found');
        error.statusCode = 404;
        throw error;
    }
    await assertEscrowMutationAccess({
        escrow: existing,
        actorId,
        allowDisputed,
    });

    if (existing.status === 'released') {
        const error = new Error('Escrow already released');
        error.statusCode = 409;
        throw error;
    }

    if (existing.status === 'refunded') {
        const error = new Error('Escrow already refunded');
        error.statusCode = 409;
        throw error;
    }

    if (existing.status === 'disputed' && !allowDisputed) {
        const error = new Error('Escrow is disputed and cannot be released directly');
        error.statusCode = 409;
        throw error;
    }

    if (existing.isFrozen && !allowDisputed) {
        const error = new Error('Escrow is frozen');
        error.statusCode = 409;
        throw error;
    }

    const releaseFilter = {
        _id: escrowId,
        status: allowDisputed ? { $in: ['funded', 'disputed'] } : 'funded',
        workerCreditTransactionId: null,
        refundTransactionId: null,
    };

    if (!allowDisputed) {
        releaseFilter.isFrozen = false;
    }

    const escrow = await Escrow.findOneAndUpdate(
        releaseFilter,
        {
            $set: {
                status: 'released',
                releasedAt: new Date(),
                isFrozen: false,
                metadata: {
                    ...(existing.metadata || {}),
                    ...metadata,
                    releasedBy: String(actorId || ''),
                },
            },
        },
        { returnDocument: 'after' }
    );

    if (!escrow) {
        const error = new Error('Escrow release race detected or invalid state');
        error.statusCode = 409;
        throw error;
    }

    const worker = await User.findById(escrow.workerId).select('subscription.plan');
    const planType = String(worker?.subscription?.plan || 'free').toLowerCase();

    const commission = await calculateCommission({
        grossAmount: escrow.amount,
        planType,
    });

    const workerCredit = await creditPending({
        userId: escrow.workerId,
        amount: commission.netAmount,
        source: 'escrow_release',
        referenceId: String(escrow._id),
        currency: escrow.currency,
        metadata: {
            commissionAmount: commission.commissionAmount,
            grossAmount: escrow.amount,
            planType,
        },
    });

    let commissionCredit = null;
    if (commission.commissionAmount > 0) {
        commissionCredit = await creditAvailable({
            userId: getPlatformUserId(),
            amount: commission.commissionAmount,
            source: 'commission',
            referenceId: String(escrow._id),
            currency: escrow.currency,
            metadata: {
                employerId: String(escrow.employerId),
                workerId: String(escrow.workerId),
                commissionConfigId: commission.configId,
            },
        });
    }

    const previousState = existing.toObject();

    escrow.workerCreditTransactionId = workerCredit.transaction._id;
    escrow.commissionTransactionId = commissionCredit?.transaction?._id || null;
    await escrow.save();

    await logFinancialAction({
        actorId,
        actionType: 'escrow.released',
        referenceId: String(escrow._id),
        previousState,
        newState: {
            status: escrow.status,
            releasedAt: escrow.releasedAt,
            workerCreditTransactionId: String(escrow.workerCreditTransactionId),
            commissionTransactionId: escrow.commissionTransactionId ? String(escrow.commissionTransactionId) : null,
        },
        metadata: {
            commission,
        },
    });

    await detectEscrowAbusePattern({ userId: escrow.employerId });

    return {
        escrow,
        commission,
    };
};

const refundEscrow = async ({ escrowId, actorId, allowDisputed = false, reason = 'manual_refund' }) => {
    const existing = await Escrow.findById(escrowId);
    if (!existing) {
        const error = new Error('Escrow not found');
        error.statusCode = 404;
        throw error;
    }
    await assertEscrowMutationAccess({
        escrow: existing,
        actorId,
        allowDisputed,
    });

    if (existing.status === 'released') {
        const error = new Error('Released escrow cannot be refunded');
        error.statusCode = 409;
        throw error;
    }

    if (existing.status === 'refunded') {
        const error = new Error('Escrow already refunded');
        error.statusCode = 409;
        throw error;
    }

    if (existing.status === 'disputed' && !allowDisputed) {
        const error = new Error('Escrow is disputed and requires admin decision');
        error.statusCode = 409;
        throw error;
    }

    const refundFilter = {
        _id: escrowId,
        status: allowDisputed ? { $in: ['funded', 'disputed'] } : 'funded',
        workerCreditTransactionId: null,
        refundTransactionId: null,
    };

    const escrow = await Escrow.findOneAndUpdate(
        refundFilter,
        {
            $set: {
                status: 'refunded',
                refundedAt: new Date(),
                isFrozen: false,
                metadata: {
                    ...(existing.metadata || {}),
                    refundReason: reason,
                    refundedBy: String(actorId || ''),
                },
            },
        },
        { returnDocument: 'after' }
    );

    if (!escrow) {
        const error = new Error('Escrow refund race detected or invalid state');
        error.statusCode = 409;
        throw error;
    }

    const employerRefund = await creditAvailable({
        userId: escrow.employerId,
        amount: escrow.amount,
        source: 'escrow_refund',
        referenceId: String(escrow._id),
        currency: escrow.currency,
        metadata: {
            reason,
        },
    });

    const previousState = existing.toObject();

    escrow.refundTransactionId = employerRefund.transaction._id;
    await escrow.save();

    await logFinancialAction({
        actorId,
        actionType: 'escrow.refunded',
        referenceId: String(escrow._id),
        previousState,
        newState: {
            status: escrow.status,
            refundedAt: escrow.refundedAt,
            refundTransactionId: String(escrow.refundTransactionId),
        },
        metadata: {
            reason,
        },
    });

    await detectEscrowAbusePattern({ userId: escrow.employerId });

    return { escrow };
};

const freezeEscrowForDispute = async ({ escrowId, disputeId }) => Escrow.findByIdAndUpdate(
    escrowId,
    {
        $set: {
            status: 'disputed',
            isFrozen: true,
            disputeId,
        },
    },
    { returnDocument: 'after' }
);

const getEscrowById = async ({ escrowId, actorId }) => {
    const escrow = await Escrow.findById(escrowId)
        .populate('employerId', 'name email')
        .populate('workerId', 'name email');
    if (!escrow) {
        return null;
    }

    await assertEscrowReadAccess({
        escrow,
        actorId,
    });

    return escrow.toObject();
};

module.exports = {
    fundEscrow,
    releaseEscrow,
    refundEscrow,
    freezeEscrowForDispute,
    getEscrowById,
};
