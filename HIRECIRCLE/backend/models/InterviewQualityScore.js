const mongoose = require('mongoose');

const interviewQualityScoreSchema = mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        processingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InterviewProcessingJob',
            default: null,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
            index: true,
        },
        clarityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        confidenceScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        completenessScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        ambiguityCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        retryCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        overallQualityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        recommendations: {
            type: [String],
            default: [],
        },
        missingSections: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
        collection: 'interview_quality_scores',
    }
);

interviewQualityScoreSchema.index({ userId: 1, createdAt: -1 });
interviewQualityScoreSchema.index({ overallQualityScore: 1, createdAt: -1 });

module.exports = mongoose.model('InterviewQualityScore', interviewQualityScoreSchema);
