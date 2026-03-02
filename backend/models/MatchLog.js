const mongoose = require('mongoose');

const matchLogSchema = mongoose.Schema(
    {
        matchRunId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MatchRun',
            required: true,
            index: true,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
            index: true,
        },
        finalScore: {
            type: Number,
            default: 0,
        },
        tier: {
            type: String,
            default: 'REJECT',
        },
        accepted: {
            type: Boolean,
            default: false,
        },
        rejectReason: {
            type: String,
            default: null,
        },
        explainability: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        matchModelVersionUsed: {
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

module.exports = mongoose.model('MatchLog', matchLogSchema);
