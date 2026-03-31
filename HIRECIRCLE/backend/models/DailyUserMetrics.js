const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyUserMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        dau: { type: Number, default: 0, min: 0 },
        mau: { type: Number, default: 0, min: 0 },
        newSignups: { type: Number, default: 0, min: 0 },
        retainedDay1: { type: Number, default: 0, min: 0 },
        retainedDay7: { type: Number, default: 0, min: 0 },
        retainedDay30: { type: Number, default: 0, min: 0 },
        day1RetentionRate: { type: Number, default: 0, min: 0 },
        day7RetentionRate: { type: Number, default: 0, min: 0 },
        day30RetentionRate: { type: Number, default: 0, min: 0 },
        highChurnRiskUsers: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyUserMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyUserMetricsSchema);

module.exports = mongoose.model('DailyUserMetrics', dailyUserMetricsSchema);

