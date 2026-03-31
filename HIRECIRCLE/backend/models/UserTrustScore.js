const mongoose = require('mongoose');

const userTrustScoreSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        reportCount: {
            type: Number,
            default: 0,
        },
        rejectedApplications: {
            type: Number,
            default: 0,
        },
        spamBehaviorScore: {
            type: Number,
            default: 0,
        },
        otpAbuseCount: {
            type: Number,
            default: 0,
        },
        rapidJobPostCount: {
            type: Number,
            default: 0,
        },
        messageFloodCount: {
            type: Number,
            default: 0,
        },
        reliabilityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        hiringSuccessScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        responseScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        completionScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        referralScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        trustGraphScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
            index: true,
        },
        rankingMultiplier: {
            type: Number,
            default: 1,
            min: 1,
            max: 1.25,
        },
        visibilityMultiplier: {
            type: Number,
            default: 1,
            min: 1,
            max: 1.5,
        },
        badgeTier: {
            type: String,
            enum: ['Basic', 'Verified', 'Pro', 'Enterprise Verified'],
            default: 'Basic',
            index: true,
        },
        score: {
            type: Number,
            min: 0,
            max: 100,
            default: 100,
            index: true,
        },
        status: {
            type: String,
            enum: ['healthy', 'watch', 'flagged', 'restricted'],
            default: 'healthy',
            index: true,
        },
        isFlagged: {
            type: Boolean,
            default: false,
            index: true,
        },
        reasons: {
            type: [String],
            default: [],
        },
        lastEvaluatedAt: {
            type: Date,
            default: Date.now,
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

module.exports = mongoose.model('UserTrustScore', userTrustScoreSchema);
