const mongoose = require('mongoose');

const scoreField = {
    type: Number,
    min: 0,
    max: 100,
    default: 50,
};

const reputationProfileSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        reliabilityScore: scoreField,
        responseScore: scoreField,
        hireSuccessScore: scoreField,
        disputeRate: scoreField,
        reportRate: scoreField,
        engagementQuality: scoreField,
        overallTrustScore: scoreField,
        updatedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        networkAuthorityScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 50,
            index: true,
        },
        completionRate: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        reliability_score: scoreField,
        completion_rate: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        cancellation_rate: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        ghosting_rate: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        response_time_avg: {
            type: Number,
            min: 0,
            default: 0,
        },
        hires_completed: {
            type: Number,
            min: 0,
            default: 0,
        },
        offers_accepted: {
            type: Number,
            min: 0,
            default: 0,
        },
        offers_rejected: {
            type: Number,
            min: 0,
            default: 0,
        },
        no_show_count: {
            type: Number,
            min: 0,
            default: 0,
        },
        verifiedHires: {
            type: Number,
            min: 0,
            default: 0,
        },
        endorsementsCount: {
            type: Number,
            min: 0,
            default: 0,
        },
        communityInfluence: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        authorityRank: {
            region: {
                type: String,
                default: 'global',
                index: true,
            },
            rank: {
                type: Number,
                min: 1,
                default: null,
            },
            percentile: {
                type: Number,
                min: 0,
                max: 100,
                default: null,
            },
        },
        visibilityMultiplier: {
            type: Number,
            min: 0.4,
            max: 1,
            default: 1,
        },
        disputeImpactPenalty: {
            type: Number,
            min: 0,
            max: 40,
            default: 0,
        },
        decayPenalty: {
            type: Number,
            min: 0,
            max: 20,
            default: 0,
        },
        adminReviewRequired: {
            type: Boolean,
            default: false,
            index: true,
        },
        breakdown: {
            type: [
                {
                    key: { type: String, required: true },
                    label: { type: String, required: true },
                    value: { type: Number, required: true },
                    weight: { type: Number, required: true },
                    contribution: { type: Number, required: true },
                },
            ],
            default: [],
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

reputationProfileSchema.index({ overallTrustScore: -1, updatedAt: -1 });
reputationProfileSchema.index({ 'authorityRank.region': 1, 'authorityRank.rank': 1 });

module.exports = mongoose.model('ReputationProfile', reputationProfileSchema);
