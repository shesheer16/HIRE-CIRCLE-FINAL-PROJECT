const mongoose = require('mongoose');

const boundedFive = {
    type: Number,
    min: 1,
    max: 5,
};

const hireFeedbackSchema = new mongoose.Schema(
    {
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            unique: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        workerProfileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            index: true,
        },
        workerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        employerFeedback: {
            skillAccuracy: boundedFive,
            communication: boundedFive,
            reliability: boundedFive,
            submittedAt: {
                type: Date,
                default: null,
            },
        },
        workerFeedback: {
            jobClarity: boundedFive,
            paymentReliability: boundedFive,
            interviewFairness: boundedFive,
            submittedAt: {
                type: Date,
                default: null,
            },
        },
        status: {
            type: String,
            enum: ['pending', 'employer_submitted', 'worker_submitted', 'completed'],
            default: 'pending',
            index: true,
        },
        trustGraphSyncedAt: {
            type: Date,
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

hireFeedbackSchema.index({ employerId: 1, status: 1, updatedAt: -1 });
hireFeedbackSchema.index({ workerUserId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('HireFeedback', hireFeedbackSchema);
