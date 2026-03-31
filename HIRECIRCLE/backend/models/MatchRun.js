const mongoose = require('mongoose');

const matchRunSchema = mongoose.Schema(
    {
        contextType: {
            type: String,
            enum: ['EMPLOYER_MATCH', 'CANDIDATE_MATCH', 'RECOMMENDED_JOBS', 'PROBABILITY_ENDPOINT'],
            required: true,
            index: true,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        modelVersionUsed: {
            type: String,
            default: null,
            index: true,
        },
        workDnaVersionId: {
            type: String,
            default: null,
            index: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
            default: 'COMPLETED',
            index: true,
        },
        triggeredBy: {
            type: String,
            default: 'match_request',
            trim: true,
            maxlength: 64,
        },
        version: {
            type: Number,
            default: 1,
            min: 1,
        },
        startedAt: {
            type: Date,
            default: Date.now,
        },
        completedAt: {
            type: Date,
            default: Date.now,
        },
        errorMessage: {
            type: String,
            default: null,
            maxlength: 1000,
        },
        totalJobsConsidered: {
            type: Number,
            default: 0,
        },
        totalMatchesReturned: {
            type: Number,
            default: 0,
        },
        avgScore: {
            type: Number,
            default: 0,
        },
        rejectReasonCounts: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
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

matchRunSchema.index({ contextType: 1, createdAt: -1 });
matchRunSchema.index({ modelVersionUsed: 1, createdAt: -1 });
matchRunSchema.index(
    { status: 1, createdAt: -1 },
    { partialFilterExpression: { status: { $in: ['PENDING', 'RUNNING'] } } }
);

matchRunSchema.pre('validate', function ensureRunTimestamps(next) {
    if (!this.startedAt && (this.status === 'RUNNING' || this.status === 'COMPLETED')) {
        this.startedAt = new Date();
    }
    if (this.status === 'COMPLETED' && !this.completedAt) {
        this.completedAt = new Date();
    }
    if (this.status === 'FAILED' && !this.completedAt) {
        this.completedAt = new Date();
    }
    if (this.status === 'RUNNING') {
        this.completedAt = null;
    }
    next();
});

module.exports = mongoose.model('MatchRun', matchRunSchema);
