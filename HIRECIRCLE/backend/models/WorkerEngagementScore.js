const mongoose = require('mongoose');

const workerEngagementScoreSchema = mongoose.Schema(
    {
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        score: {
            type: Number,
            default: 0,
            index: true,
        },
        interviewVerified: {
            type: Boolean,
            default: false,
        },
        applicationFrequency30d: {
            type: Number,
            default: 0,
        },
        shortlistRatio: {
            type: Number,
            default: 0,
        },
        avgResponseHours: {
            type: Number,
            default: 72,
        },
        retentionSuccessRate: {
            type: Number,
            default: 0,
        },
        badgeEligible: {
            type: Boolean,
            default: false,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
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

workerEngagementScoreSchema.index({ score: -1, computedAt: -1 });

module.exports = mongoose.model('WorkerEngagementScore', workerEngagementScoreSchema);
