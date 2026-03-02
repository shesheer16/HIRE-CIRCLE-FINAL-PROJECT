const mongoose = require('mongoose');

const aiUsageMetricSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        interviewProcessingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InterviewProcessingJob',
            default: null,
            index: true,
        },
        operation: {
            type: String,
            required: true,
            index: true,
        },
        provider: {
            type: String,
            default: 'gemini',
            index: true,
        },
        model: {
            type: String,
            required: true,
            index: true,
        },
        fallbackModel: {
            type: String,
            default: null,
        },
        region: {
            type: String,
            default: 'unknown',
            index: true,
        },
        promptChars: {
            type: Number,
            default: 0,
            min: 0,
        },
        outputChars: {
            type: Number,
            default: 0,
            min: 0,
        },
        estimatedInputTokens: {
            type: Number,
            default: 0,
            min: 0,
        },
        estimatedOutputTokens: {
            type: Number,
            default: 0,
            min: 0,
        },
        estimatedTotalTokens: {
            type: Number,
            default: 0,
            min: 0,
            index: true,
        },
        estimatedCostUsd: {
            type: Number,
            default: 0,
            min: 0,
            index: true,
        },
        status: {
            type: String,
            enum: ['success', 'failed', 'blocked'],
            default: 'success',
            index: true,
        },
        error: {
            type: String,
            default: null,
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

aiUsageMetricSchema.index({ createdAt: -1, userId: 1, operation: 1 });
aiUsageMetricSchema.index({ createdAt: -1, provider: 1, model: 1 });

module.exports = mongoose.model('AiUsageMetric', aiUsageMetricSchema);
