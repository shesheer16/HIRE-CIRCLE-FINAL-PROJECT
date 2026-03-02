const mongoose = require('mongoose');

const regionMetricsSchema = new mongoose.Schema(
    {
        region: {
            type: String,
            required: true,
            index: true,
            uppercase: true,
            trim: true,
        },
        country: {
            type: String,
            default: 'GLOBAL',
            uppercase: true,
            trim: true,
            index: true,
        },
        activeUsers: {
            type: Number,
            default: 0,
            min: 0,
        },
        hires: {
            type: Number,
            default: 0,
            min: 0,
        },
        revenue: {
            type: Number,
            default: 0,
            min: 0,
        },
        engagement: {
            type: Number,
            default: 0,
            min: 0,
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

regionMetricsSchema.index({ region: 1, capturedAt: -1 });
regionMetricsSchema.index({ country: 1, capturedAt: -1 });

module.exports = mongoose.model('RegionMetrics', regionMetricsSchema);
