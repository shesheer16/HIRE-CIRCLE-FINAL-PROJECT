const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyTrustMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        averageTrustScore: { type: Number, default: 0, min: 0 },
        flaggedUsers: { type: Number, default: 0, min: 0 },
        highTrustHireSpeedHours: { type: Number, default: 0, min: 0 },
        lowTrustHireSpeedHours: { type: Number, default: 0, min: 0 },
        highTrustCloseSpeedMultiplier: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyTrustMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyTrustMetricsSchema);

module.exports = mongoose.model('DailyTrustMetrics', dailyTrustMetricsSchema);

