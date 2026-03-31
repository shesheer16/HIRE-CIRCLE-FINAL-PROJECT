const mongoose = require('mongoose');

const userBadgeSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        badgeKey: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        badgeName: {
            type: String,
            required: true,
            trim: true,
        },
        source: {
            type: String,
            enum: ['auto', 'admin_override'],
            default: 'auto',
            index: true,
        },
        awardedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        criteriaSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

userBadgeSchema.index({ userId: 1, badgeKey: 1 }, { unique: true });
userBadgeSchema.index({ userId: 1, active: 1, awardedAt: -1 });

module.exports = mongoose.model('UserBadge', userBadgeSchema);
