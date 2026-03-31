const mongoose = require('mongoose');

const interviewSignalSchema = mongoose.Schema(
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
        processingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InterviewProcessingJob',
            required: true,
            unique: true,
            index: true,
        },
        videoDuration: {
            type: Number,
            default: null,
        },
        transcriptWordCount: {
            type: Number,
            default: null,
        },
        confidenceScore: {
            type: Number,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'interview_signals',
    }
);

module.exports = mongoose.model('InterviewSignal', interviewSignalSchema);
