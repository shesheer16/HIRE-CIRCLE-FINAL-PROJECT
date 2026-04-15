const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const funnelAnalyticsDailySchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        region: { type: String, default: 'GLOBAL', uppercase: true, trim: true, index: true },
        role: { type: String, default: 'general', trim: true, index: true },
        stageCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
        stageDropOff: { type: mongoose.Schema.Types.Mixed, default: {} },
        stageConversions: { type: mongoose.Schema.Types.Mixed, default: {} },
        fullFunnelConversionRate: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

funnelAnalyticsDailySchema.index({ dateKey: 1, region: 1, role: 1 }, { unique: true });
applyAppendOnlyGuards(funnelAnalyticsDailySchema);

module.exports = mongoose.model('FunnelAnalyticsDaily', funnelAnalyticsDailySchema);

