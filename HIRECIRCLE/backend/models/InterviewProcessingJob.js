const mongoose = require('mongoose');

const interviewProcessingJobSchema = mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: ['worker', 'employer'],
            required: true,
        },
        videoUrl: {
            type: String,
            required: true,
        },
        videoHash: {
            type: String,
            required: true,
            index: true,
        },
        idempotencyKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed'],
            default: 'pending',
            index: true,
        },
        extractedData: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        createdJobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
        },
        errorMessage: {
            type: String,
            default: null,
        },
        rawMetrics: {
            videoDuration: { type: Number, default: null },
            transcriptWordCount: { type: Number, default: null },
            confidenceScore: { type: Number, default: null },
            profileQualityScore: { type: Number, default: null },
            slotCompletenessRatio: { type: Number, default: null },
            ambiguityRate: { type: Number, default: null },
            communicationClarityScore: { type: Number, default: null },
            confidenceLanguageScore: { type: Number, default: null },
            salaryOutlierFlag: { type: Boolean, default: false },
            salaryMedianForRoleCity: { type: Number, default: null },
            salaryRealismRatio: { type: Number, default: null },
            experienceSkillConsistencyFlag: { type: Boolean, default: false },
            communicationMetricsAggregate: {
                type: mongoose.Schema.Types.Mixed,
                default: {},
            },
        },
        slotState: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        slotConfidence: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        ambiguousFields: {
            type: [String],
            default: [],
        },
        missingSlot: {
            type: String,
            default: null,
        },
        interviewComplete: {
            type: Boolean,
            default: false,
        },
        interviewStep: {
            type: Number,
            default: 0,
        },
        maxSteps: {
            type: Number,
            default: 8,
        },
        adaptiveQuestion: {
            type: String,
            default: null,
        },
        clarificationHints: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        latestTranscriptSnippet: {
            type: String,
            default: null,
        },
        lastTurnSignature: {
            type: String,
            default: null,
        },
        lastTurnAt: {
            type: Date,
            default: null,
        },
        lastStateSignature: {
            type: String,
            default: null,
        },
        stagnationCount: {
            type: Number,
            default: 0,
        },
        turnLockUntil: {
            type: Date,
            default: null,
            index: true,
        },
        clarificationTriggeredCount: {
            type: Number,
            default: 0,
        },
        clarificationResolvedCount: {
            type: Number,
            default: 0,
        },
        clarificationSkippedCount: {
            type: Number,
            default: 0,
        },
        startedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        notificationSentAt: {
            type: Date,
            default: null,
        },
        profileConfirmedAt: {
            type: Date,
            default: null,
        },
        jobConfirmedAt: {
            type: Date,
            default: null,
        },
        signalFinalizedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'interview_processing_jobs',
    }
);

interviewProcessingJobSchema.index({ userId: 1, createdAt: -1 });
interviewProcessingJobSchema.index({ userId: 1, status: 1, createdAt: -1 });
interviewProcessingJobSchema.index({ createdAt: 1 });
interviewProcessingJobSchema.index(
    { completedAt: 1 },
    {
        expireAfterSeconds: 30 * 24 * 60 * 60,
        partialFilterExpression: { status: 'failed', completedAt: { $type: 'date' } },
    }
);

module.exports = mongoose.model('InterviewProcessingJob', interviewProcessingJobSchema);
