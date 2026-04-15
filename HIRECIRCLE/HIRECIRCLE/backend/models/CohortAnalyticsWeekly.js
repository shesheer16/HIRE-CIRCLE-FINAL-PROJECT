const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const cohortAnalyticsWeeklySchema = new mongoose.Schema(
    {
        snapshotDateKey: { type: String, required: true, index: true },
        cohortWeekKey: { type: String, required: true, index: true },
        cohortWeekStartUTC: { type: Date, required: true, index: true },
        cohortWeekEndUTC: { type: Date, required: true },
        totalUsers: { type: Number, default: 0, min: 0 },
        retainedDay1: { type: Number, default: 0, min: 0 },
        retainedDay7: { type: Number, default: 0, min: 0 },
        retainedDay30: { type: Number, default: 0, min: 0 },
        day1RetentionRate: { type: Number, default: 0, min: 0 },
        day7RetentionRate: { type: Number, default: 0, min: 0 },
        day30RetentionRate: { type: Number, default: 0, min: 0 },
        interviewCompletionRate: { type: Number, default: 0, min: 0 },
        revenueTotal: { type: Number, default: 0 },
        revenuePerUser: { type: Number, default: 0 },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

cohortAnalyticsWeeklySchema.index({ snapshotDateKey: 1, cohortWeekKey: 1 }, { unique: true });
cohortAnalyticsWeeklySchema.index({ cohortWeekKey: 1, computedAt: -1 });
applyAppendOnlyGuards(cohortAnalyticsWeeklySchema);

module.exports = mongoose.model('CohortAnalyticsWeekly', cohortAnalyticsWeeklySchema);

