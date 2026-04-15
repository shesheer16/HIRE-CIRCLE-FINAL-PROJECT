const mongoose = require('mongoose');

const thresholdSchema = new mongoose.Schema(
    {
        strongMin: { type: Number, required: true },
        goodMin: { type: Number, required: true },
        possibleMin: { type: Number, required: true },
    },
    { _id: false }
);

const matchModelCalibrationSchema = mongoose.Schema(
    {
        modelVersion: {
            type: String,
            default: null,
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
        evaluatedFrom: {
            type: Date,
            required: true,
        },
        evaluatedTo: {
            type: Date,
            required: true,
        },
        currentThresholds: {
            type: thresholdSchema,
            required: true,
        },
        suggestedThresholds: {
            type: thresholdSchema,
            required: true,
        },
        diagnostics: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        suggestions: {
            type: [String],
            default: [],
        },
        driftDetected: {
            type: Boolean,
            default: false,
        },
        requiresRetrain: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['suggested', 'applied', 'dismissed'],
            default: 'suggested',
            index: true,
        },
        createdBy: {
            type: String,
            default: 'system',
        },
    },
    {
        timestamps: true,
    }
);

matchModelCalibrationSchema.index({ city: 1, roleCluster: 1, createdAt: -1 });
matchModelCalibrationSchema.index({ modelVersion: 1, createdAt: -1 });

module.exports = mongoose.model('MatchModelCalibration', matchModelCalibrationSchema);
