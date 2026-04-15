const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyEngagementMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        messagesSent: { type: Number, default: 0, min: 0 },
        applicationsSubmitted: { type: Number, default: 0, min: 0 },
        activeEmployers: { type: Number, default: 0, min: 0 },
        activeWorkers: { type: Number, default: 0, min: 0 },
        averageEmployerResponseTimeMinutes: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyEngagementMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyEngagementMetricsSchema);

module.exports = mongoose.model('DailyEngagementMetrics', dailyEngagementMetricsSchema);

