const mongoose = require('mongoose');

const cityExpansionSignalSchema = mongoose.Schema(
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
        workerSupplyScore: {
            type: Number,
            default: 0,
        },
        employerDemandScore: {
            type: Number,
            default: 0,
        },
        fillRateTrend: {
            type: Number,
            default: 0,
        },
        retention30dTrend: {
            type: Number,
            default: 0,
        },
        boostRevenueTrend: {
            type: Number,
            default: 0,
        },
        expansionReadinessScore: {
            type: Number,
            default: 0,
            index: true,
        },
        readinessStatus: {
            type: String,
            enum: ['NOT_READY', 'WATCHLIST', 'READY_FOR_SCALE'],
            default: 'NOT_READY',
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

cityExpansionSignalSchema.index({ city: 1, day: -1 }, { unique: true });

module.exports = mongoose.model('CityExpansionSignal', cityExpansionSignalSchema);
