const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const breakdownItemSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        value: { type: Number, default: 0 },
    },
    { _id: false }
);

const dailyFinancialMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        revenueTotal: { type: Number, default: 0 },
        revenuePerUser: { type: Number, default: 0 },
        mrr: { type: Number, default: 0 },
        arrProjection: { type: Number, default: 0 },
        escrowVolume: { type: Number, default: 0 },
        escrowReleaseRate: { type: Number, default: 0 },
        ledgerConsistencyDelta: { type: Number, default: 0 },
        revenueByFeature: { type: [breakdownItemSchema], default: [] },
        revenueByRegion: { type: [breakdownItemSchema], default: [] },
        revenueByTrustTier: { type: [breakdownItemSchema], default: [] },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyFinancialMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyFinancialMetricsSchema);

module.exports = mongoose.model('DailyFinancialMetrics', dailyFinancialMetricsSchema);

