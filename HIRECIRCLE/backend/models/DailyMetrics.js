const mongoose = require('mongoose');

const dailyMetricsSchema = new mongoose.Schema(
    {
        day: {
            type: Date,
            required: true,
            unique: true,
            index: true,
        },
        activeUsers: {
            type: Number,
            default: 0,
        },
        jobPosts: {
            type: Number,
            default: 0,
        },
        applications: {
            type: Number,
            default: 0,
        },
        acceptanceRate: {
            type: Number,
            default: 0,
        },
        interviewCompletions: {
            type: Number,
            default: 0,
        },
        chatEngagement: {
            type: Number,
            default: 0,
        },
        computedAt: {
            type: Date,
            default: Date.now,
        },
        source: {
            type: String,
            default: 'background_job',
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('DailyMetrics', dailyMetricsSchema);
