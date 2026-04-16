const mongoose = require('mongoose');

const matchModelSchema = mongoose.Schema(
    {
        modelVersion: {
            type: String,
            required: true,
            index: true,
        },
        modelKey: {
            type: String,
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: '*',
            index: true,
        },
        roleCluster: {
            type: String,
            default: '*',
            index: true,
        },
        featureOrder: {
            type: [String],
            required: true,
            default: [],
        },
        weights: {
            type: [Number],
            required: true,
            default: [],
        },
        intercept: {
            type: Number,
            required: true,
            default: 0,
        },
        sampleCount: {
            type: Number,
            default: 0,
        },
        positiveCount: {
            type: Number,
            default: 0,
        },
        metrics: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        isActive: {
            type: Boolean,
            default: false,
            index: true,
        },
        trainedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

matchModelSchema.index({ modelVersion: 1, modelKey: 1 }, { unique: true });
matchModelSchema.index({ isActive: 1, trainedAt: -1 });

module.exports = mongoose.model('MatchModel', matchModelSchema);
