const mongoose = require('mongoose');

const backgroundJobSchema = new mongoose.Schema(
    {
        queue: {
            type: String,
            required: true,
            default: 'platform_intelligence',
            index: true,
        },
        type: {
            type: String,
            required: true,
            index: true,
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        status: {
            type: String,
            enum: ['queued', 'processing', 'completed', 'failed', 'dead_letter'],
            default: 'queued',
            index: true,
        },
        attempts: {
            type: Number,
            default: 0,
        },
        maxAttempts: {
            type: Number,
            default: 3,
        },
        runAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        processedAt: {
            type: Date,
            default: null,
        },
        lastError: {
            type: String,
            default: null,
        },
        retryHistory: {
            type: [String],
            default: [],
        },
        deadLetteredAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

backgroundJobSchema.index({ queue: 1, status: 1, runAt: 1 });

module.exports = mongoose.model('BackgroundJob', backgroundJobSchema);
