const mongoose = require('mongoose');

const growthMetricsSchema = mongoose.Schema(
    {
        dateKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        windowStart: {
            type: Date,
            required: true,
        },
        windowEnd: {
            type: Date,
            required: true,
        },
        counters: {
            signups: { type: Number, default: 0 },
            otpVerified: { type: Number, default: 0 },
            otpDropOff: { type: Number, default: 0 },
            interviewsCompleted: { type: Number, default: 0 },
            applicationsSubmitted: { type: Number, default: 0 },
            employerResponses: { type: Number, default: 0 },
            chatEngagedUsers: { type: Number, default: 0 },
            retainedDay1: { type: Number, default: 0 },
            retainedDay7: { type: Number, default: 0 },
            retainedDay30: { type: Number, default: 0 },
        },
        rates: {
            signupConversionRate: { type: Number, default: 0 },
            otpDropOffRate: { type: Number, default: 0 },
            interviewCompletionRate: { type: Number, default: 0 },
            jobApplyRate: { type: Number, default: 0 },
            employerResponseRate: { type: Number, default: 0 },
            chatEngagementRate: { type: Number, default: 0 },
            retentionDay1Rate: { type: Number, default: 0 },
            retentionDay7Rate: { type: Number, default: 0 },
            retentionDay30Rate: { type: Number, default: 0 },
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

growthMetricsSchema.index({ computedAt: -1 });

module.exports = mongoose.model('GrowthMetrics', growthMetricsSchema);
