const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyPerformanceMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        avgApiLatencyMs: { type: Number, default: 0, min: 0 },
        errorRate: { type: Number, default: 0, min: 0 },
        aiCallSuccessRate: { type: Number, default: 0, min: 0 },
        queueBacklog: { type: Number, default: 0, min: 0 },
        dbQueryLatencyMs: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyPerformanceMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyPerformanceMetricsSchema);

module.exports = mongoose.model('DailyPerformanceMetrics', dailyPerformanceMetricsSchema);

