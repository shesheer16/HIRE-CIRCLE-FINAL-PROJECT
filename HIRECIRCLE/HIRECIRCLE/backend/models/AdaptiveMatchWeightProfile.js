const mongoose = require('mongoose');

const adaptiveMatchWeightProfileSchema = mongoose.Schema(
    {
        scopeType: {
            type: String,
            enum: ['global', 'city_role'],
            default: 'global',
            index: true,
        },
        scopeKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        skillWeight: {
            type: Number,
            default: 0.4,
        },
        experienceWeight: {
            type: Number,
            default: 0.25,
        },
        salaryToleranceWeight: {
            type: Number,
            default: 0.2,
        },
        commuteToleranceWeight: {
            type: Number,
            default: 0.15,
        },
        sampleSize: {
            type: Number,
            default: 0,
            index: true,
        },
        updateCount: {
            type: Number,
            default: 0,
        },
        guardrails: {
            type: mongoose.Schema.Types.Mixed,
            default: {
                minWeight: 0.05,
                maxWeight: 0.6,
                maxDeltaPerUpdate: 0.015,
                antiBiasDamping: 1,
            },
        },
        lastOutcomeAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'adaptive_match_weight_profiles',
    }
);

adaptiveMatchWeightProfileSchema.index({ scopeType: 1, updatedAt: -1 });

module.exports = mongoose.model('AdaptiveMatchWeightProfile', adaptiveMatchWeightProfileSchema);
