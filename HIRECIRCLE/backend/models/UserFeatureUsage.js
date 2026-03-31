const mongoose = require('mongoose');

const userFeatureUsageSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        featureKey: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        usageCount: {
            type: Number,
            default: 0,
        },
        lastUsedAt: {
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

userFeatureUsageSchema.index({ user: 1, featureKey: 1 }, { unique: true });

module.exports = mongoose.model('UserFeatureUsage', userFeatureUsageSchema);
