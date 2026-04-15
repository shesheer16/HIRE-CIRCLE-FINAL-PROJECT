const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema(
    {
        escrowId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Escrow',
            required: true,
            index: true,
        },
        raisedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['open', 'under_review', 'resolved', 'rejected'],
            default: 'open',
            index: true,
        },
        adminDecision: {
            type: String,
            enum: ['release_to_worker', 'refund_to_employer', 'split', 'none'],
            default: 'none',
        },
        resolutionNote: {
            type: String,
            default: null,
        },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

disputeSchema.index(
    { escrowId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: { status: { $in: ['open', 'under_review'] } },
    }
);

module.exports = mongoose.model('Dispute', disputeSchema);
