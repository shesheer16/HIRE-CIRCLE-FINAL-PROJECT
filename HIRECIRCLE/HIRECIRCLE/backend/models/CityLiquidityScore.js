const mongoose = require('mongoose');

const cityLiquidityScoreSchema = mongoose.Schema(
    {
        city: {
            type: String,
            required: true,
            index: true,
        },
        day: {
            type: Date,
            required: true,
            index: true,
        },
        activeWorkers30d: {
            type: Number,
            default: 0,
        },
        activeEmployers30d: {
            type: Number,
            default: 0,
        },
        openJobs: {
            type: Number,
            default: 0,
        },
        workersPerJob: {
            type: Number,
            default: 0,
        },
        avgTimeToFill: {
            type: Number,
            default: 0,
        },
        fillRate: {
            type: Number,
            default: 0,
        },
        churnRate: {
            type: Number,
            default: 0,
        },
        marketBand: {
            type: String,
            enum: ['under_supplied', 'balanced', 'over_supplied'],
            default: 'balanced',
            index: true,
        },
        acquisitionAlertTriggered: {
            type: Boolean,
            default: false,
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

cityLiquidityScoreSchema.index({ city: 1, day: -1 }, { unique: true });

module.exports = mongoose.model('CityLiquidityScore', cityLiquidityScoreSchema);
