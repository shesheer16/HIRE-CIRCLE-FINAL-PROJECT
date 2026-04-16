const mongoose = require('mongoose');

const communityTrustScoreSchema = new mongoose.Schema(
    {
        circleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Circle',
            required: true,
            unique: true,
            index: true,
        },
        communityTrustScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 50,
            index: true,
        },
        memberTrustAverage: {
            type: Number,
            min: 0,
            max: 100,
            default: 50,
        },
        disputeRatio: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        activityQuality: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        moderationEffectiveness: {
            type: Number,
            min: 0,
            max: 100,
            default: 50,
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

communityTrustScoreSchema.index({ communityTrustScore: -1, computedAt: -1 });

module.exports = mongoose.model('CommunityTrustScore', communityTrustScoreSchema);
