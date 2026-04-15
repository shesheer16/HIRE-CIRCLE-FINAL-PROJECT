const Dispute = require('../../models/Dispute');
const Escrow = require('../../models/Escrow');
const { freezeEscrowForDispute, releaseEscrow, refundEscrow } = require('./escrowService');
const { creditPending, creditAvailable } = require('./ledgerService');
const { logFinancialAction } = require('./auditLogService');

const raiseDispute = async ({ escrowId, raisedBy, reason, metadata = {} }) => {
    const escrow = await Escrow.findById(escrowId);
    if (!escrow) {
        const error = new Error('Escrow not found');
        error.statusCode = 404;
        throw error;
    }

    if (escrow.status === 'refunded' || escrow.status === 'released') {
        const error = new Error('Cannot dispute finalized escrow');
        error.statusCode = 409;
        throw error;
    }

    const existing = await Dispute.findOne({
        escrowId,
        status: { $in: ['open', 'under_review'] },
    });

    if (existing) {
        return {
            dispute: existing,
            created: false,
        };
    }

    const dispute = await Dispute.create({
        escrowId,
        raisedBy,
        reason,
        status: 'open',
        metadata,
    });

    const previousState = escrow.toObject();
    const updatedEscrow = await freezeEscrowForDispute({ escrowId, disputeId: dispute._id });

    await logFinancialAction({
        actorId: raisedBy,
        actionType: 'dispute.raised',
        referenceId: String(dispute._id),
        previousState,
        newState: {
            escrowStatus: updatedEscrow?.status,
            escrowFrozen: updatedEscrow?.isFrozen,
            disputeStatus: dispute.status,
        },
        metadata: {
            reason,
        },
    });

    return {
        dispute,
        created: true,
    };
};

const resolveSplit = async ({ escrow, actorId, splitRatio = 0.5, resolutionNote = '' }) => {
    const safeRatio = Math.min(0.9, Math.max(0.1, Number(splitRatio) || 0.5));
    const workerAmount = Math.round((Number(escrow.amount) * safeRatio) * 100) / 100;
    const employerAmount = Math.round((Number(escrow.amount) - workerAmount) * 100) / 100;

    const workerCredit = await creditPending({
        userId: escrow.workerId,
        amount: workerAmount,
        source: 'escrow_release',
        referenceId: String(escrow._id),
        currency: escrow.currency,
        metadata: {
            decision: 'split',
            splitRatio: safeRatio,
        },
    });

    const employerRefund = await creditAvailable({
        userId: escrow.employerId,
        amount: employerAmount,
        source: 'escrow_refund',
        referenceId: String(escrow._id),
        currency: escrow.currency,
        metadata: {
            decision: 'split',
            splitRatio: safeRatio,
        },
    });

    const updatedEscrow = await Escrow.findOneAndUpdate(
        {
            _id: escrow._id,
            status: 'disputed',
            workerCreditTransactionId: null,
            refundTransactionId: null,
        },
        {
            $set: {
                status: 'released',
                isFrozen: false,
                releasedAt: new Date(),
                workerCreditTransactionId: workerCredit.transaction._id,
                refundTransactionId: employerRefund.transaction._id,
                metadata: {
                    ...(escrow.metadata || {}),
                    disputeDecision: 'split',
                    splitRatio: safeRatio,
                    splitResolutionNote: resolutionNote,
                    resolvedBy: String(actorId || ''),
                },
            },
        },
        { returnDocument: 'after' }
    );

    if (!updatedEscrow) {
        const error = new Error('Split settlement race detected');
        error.statusCode = 409;
        throw error;
    }

    return {
        escrow: updatedEscrow,
        split: {
            ratio: safeRatio,
            workerAmount,
            employerAmount,
        },
    };
};

const resolveDispute = async ({
    disputeId,
    actorId,
    adminDecision,
    resolutionNote = '',
    splitRatio = 0.5,
}) => {
    const dispute = await Dispute.findById(disputeId);
    if (!dispute) {
        const error = new Error('Dispute not found');
        error.statusCode = 404;
        throw error;
    }

    if (!['open', 'under_review'].includes(dispute.status)) {
        const error = new Error('Dispute is already resolved');
        error.statusCode = 409;
        throw error;
    }

    const escrow = await Escrow.findById(dispute.escrowId);
    if (!escrow) {
        const error = new Error('Escrow for dispute not found');
        error.statusCode = 404;
        throw error;
    }

    let resolutionResult = null;

    if (adminDecision === 'release_to_worker') {
        resolutionResult = await releaseEscrow({
            escrowId: escrow._id,
            actorId,
            allowDisputed: true,
            metadata: {
                disputeId: String(dispute._id),
                resolutionNote,
            },
        });
    } else if (adminDecision === 'refund_to_employer') {
        resolutionResult = await refundEscrow({
            escrowId: escrow._id,
            actorId,
            allowDisputed: true,
            reason: resolutionNote || 'dispute_refund',
        });
    } else if (adminDecision === 'split') {
        resolutionResult = await resolveSplit({
            escrow,
            actorId,
            splitRatio,
            resolutionNote,
        });
    } else {
        throw new Error('Invalid admin decision');
    }

    const previousState = dispute.toObject();
    dispute.status = 'resolved';
    dispute.adminDecision = adminDecision;
    dispute.resolutionNote = resolutionNote || null;
    dispute.resolvedBy = actorId;
    dispute.resolvedAt = new Date();
    await dispute.save();

    await logFinancialAction({
        actorId,
        actionType: 'dispute.resolved',
        referenceId: String(dispute._id),
        previousState,
        newState: {
            status: dispute.status,
            adminDecision: dispute.adminDecision,
            resolvedAt: dispute.resolvedAt,
        },
        metadata: {
            escrowId: String(dispute.escrowId),
            resolutionNote,
            splitRatio,
        },
    });

    return {
        dispute,
        resolutionResult,
    };
};

const listDisputes = async ({ status = null, limit = 100 }) => {
    const query = {};
    if (status) query.status = status;

    return Dispute.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
        .lean();
};

module.exports = {
    raiseDispute,
    resolveDispute,
    listDisputes,
};
