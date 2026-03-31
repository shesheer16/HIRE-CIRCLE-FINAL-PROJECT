const mongoose = require('mongoose');

const fraudFlagSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        flagType: {
            type: String,
            enum: ['multi_account', 'payment_failures', 'rapid_refund', 'escrow_abuse'],
            required: true,
            index: true,
        },
        reason: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ['open', 'reviewing', 'resolved', 'dismissed'],
            default: 'open',
            index: true,
        },
        score: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },
        relatedUsers: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'User',
            default: [],
        },
        evidence: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

fraudFlagSchema.index({ userId: 1, flagType: 1, createdAt: -1 });

module.exports = mongoose.model('FraudFlag', fraudFlagSchema);
