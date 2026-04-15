const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyRegionMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        region: { type: String, required: true, uppercase: true, trim: true, index: true },
        country: { type: String, default: 'GLOBAL', uppercase: true, trim: true, index: true },
        dau: { type: Number, default: 0, min: 0 },
        newSignups: { type: Number, default: 0, min: 0 },
        applicationsCreated: { type: Number, default: 0, min: 0 },
        hires: { type: Number, default: 0, min: 0 },
        revenue: { type: Number, default: 0 },
        conversionRate: { type: Number, default: 0, min: 0 },
        revenuePerActiveUser: { type: Number, default: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyRegionMetricsSchema.index({ dateKey: 1, region: 1 }, { unique: true });
dailyRegionMetricsSchema.index({ region: 1, computedAt: -1 });
applyAppendOnlyGuards(dailyRegionMetricsSchema);

module.exports = mongoose.model('DailyRegionMetrics', dailyRegionMetricsSchema);

