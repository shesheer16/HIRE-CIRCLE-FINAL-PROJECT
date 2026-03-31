const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const dailyJobMetricsSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        newJobs: { type: Number, default: 0, min: 0 },
        applicationsCreated: { type: Number, default: 0, min: 0 },
        interviewsCompleted: { type: Number, default: 0, min: 0 },
        offersCreated: { type: Number, default: 0, min: 0 },
        hires: { type: Number, default: 0, min: 0 },
        interviewCompletionRate: { type: Number, default: 0, min: 0 },
        hireSuccessRate: { type: Number, default: 0, min: 0 },
        averageHiringTimeHours: { type: Number, default: 0, min: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

dailyJobMetricsSchema.index({ computedAt: -1 });
applyAppendOnlyGuards(dailyJobMetricsSchema);

module.exports = mongoose.model('DailyJobMetrics', dailyJobMetricsSchema);

