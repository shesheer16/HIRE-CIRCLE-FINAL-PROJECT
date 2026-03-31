const mongoose = require('mongoose');

const matchOutcomeModelSchema = mongoose.Schema(
    {
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        applicantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            index: true,
        },
        hired: {
            type: Boolean,
            default: false,
            index: true,
        },
        rejected: {
            type: Boolean,
            default: false,
            index: true,
        },
        timeToResponse: {
            type: Number,
            default: null,
        },
        employerFeedbackScore: {
            type: Number,
            default: null,
            min: 0,
            max: 1,
        },
        workerFeedbackScore: {
            type: Number,
            default: null,
            min: 0,
            max: 1,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'match_outcomes',
    }
);

matchOutcomeModelSchema.index({ jobId: 1, applicantId: 1, createdAt: -1 });
matchOutcomeModelSchema.index({ createdAt: -1, hired: 1, rejected: 1 });

module.exports = mongoose.model('MatchOutcomeModel', matchOutcomeModelSchema);
