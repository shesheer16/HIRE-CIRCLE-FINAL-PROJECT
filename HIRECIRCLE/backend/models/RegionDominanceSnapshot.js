const mongoose = require('mongoose');

const regionDominanceSnapshotSchema = new mongoose.Schema(
    {
        region: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            index: true,
        },
        country: {
            type: String,
            default: 'GLOBAL',
            trim: true,
            uppercase: true,
            index: true,
        },
        activeUsers: {
            type: Number,
            default: 0,
            min: 0,
        },
        activeJobs: {
            type: Number,
            default: 0,
            min: 0,
        },
        hires: {
            type: Number,
            default: 0,
            min: 0,
        },
        hireDensity: {
            type: Number,
            default: 0,
            min: 0,
        },
        dominanceScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        marketBand: {
            type: String,
            enum: ['dominant', 'balanced', 'weak', 'critical'],
            default: 'balanced',
            index: true,
        },
        weaknessSignals: {
            type: [String],
            default: [],
        },
        campaignTriggered: {
            type: Boolean,
            default: false,
            index: true,
        },
        capturedAt: {
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

regionDominanceSnapshotSchema.index({ region: 1, capturedAt: -1 });
regionDominanceSnapshotSchema.index({ marketBand: 1, capturedAt: -1 });

module.exports = mongoose.model('RegionDominanceSnapshot', regionDominanceSnapshotSchema);
