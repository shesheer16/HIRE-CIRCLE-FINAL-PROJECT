const mongoose = require('mongoose');

const BADGE_TIERS = ['Basic', 'Verified', 'Pro', 'Enterprise Verified'];

const userVerificationBadgeSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        tier: {
            type: String,
            enum: BADGE_TIERS,
            default: 'Basic',
            index: true,
        },
        signals: {
            govtIdVerified: {
                type: Boolean,
                default: false,
            },
            companyRegistrationVerified: {
                type: Boolean,
                default: false,
            },
            escrowUsageCount: {
                type: Number,
                default: 0,
                min: 0,
            },
            successfulHiresCount: {
                type: Number,
                default: 0,
                min: 0,
            },
        },
        rankingBoostMultiplier: {
            type: Number,
            default: 1,
            min: 1,
            max: 1.25,
        },
        visibilityBoostMultiplier: {
            type: Number,
            default: 1,
            min: 1,
            max: 1.5,
        },
        trustBoostPoints: {
            type: Number,
            default: 0,
            min: 0,
            max: 20,
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

userVerificationBadgeSchema.index({ tier: 1, computedAt: -1 });

module.exports = {
    UserVerificationBadge: mongoose.model('UserVerificationBadge', userVerificationBadgeSchema),
    USER_BADGE_TIERS: BADGE_TIERS,
};
