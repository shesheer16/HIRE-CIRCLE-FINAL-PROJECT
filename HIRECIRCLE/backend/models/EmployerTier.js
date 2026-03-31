const mongoose = require('mongoose');

const employerTierSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        tier: {
            type: String,
            enum: ['Platinum', 'Gold', 'Silver', 'Standard'],
            default: 'Standard',
            index: true,
        },
        score: {
            type: Number,
            default: 0,
        },
        hireCompletionRate: {
            type: Number,
            default: 0,
        },
        paymentReliability: {
            type: Number,
            default: 0,
        },
        retention30dRate: {
            type: Number,
            default: 0,
        },
        responseTimeHours: {
            type: Number,
            default: 72,
        },
        rankingBoostMultiplier: {
            type: Number,
            default: 1,
        },
        candidateSurfacingPriority: {
            type: Number,
            default: 1,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
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

employerTierSchema.index({ tier: 1, computedAt: -1 });

module.exports = mongoose.model('EmployerTier', employerTierSchema);
