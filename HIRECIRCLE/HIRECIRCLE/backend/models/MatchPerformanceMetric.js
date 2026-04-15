const mongoose = require('mongoose');

const matchPerformanceMetricSchema = mongoose.Schema(
    {
        eventName: {
            type: String,
            enum: [
                'MATCH_RECOMMENDATION_VIEWED',
                'MATCH_DETAIL_VIEWED',
                'APPLICATION_CREATED',
                'APPLICATION_SHORTLISTED',
                'APPLICATION_INTERVIEWED',
                'APPLICATION_HIRED',
                'OFFER_EXTENDED',
                'OFFER_ACCEPTED',
                'WORKER_JOINED',
                'JOB_FILL_COMPLETED',
            ],
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
        },
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            default: null,
        },
        city: {
            type: String,
            default: 'unknown',
            index: true,
        },
        roleCluster: {
            type: String,
            default: 'general',
            index: true,
        },
        matchProbability: {
            type: Number,
            min: 0,
            max: 1,
            default: null,
        },
        matchTier: {
            type: String,
            enum: ['STRONG', 'GOOD', 'POSSIBLE', 'REJECT', 'UNKNOWN'],
            default: 'UNKNOWN',
        },
        modelVersionUsed: {
            type: String,
            default: null,
            index: true,
        },
        timestamp: {
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

matchPerformanceMetricSchema.index({ city: 1, roleCluster: 1, timestamp: -1 });
matchPerformanceMetricSchema.index({ jobId: 1, workerId: 1 });
matchPerformanceMetricSchema.index({ eventName: 1, timestamp: -1 });

module.exports = mongoose.model('MatchPerformanceMetric', matchPerformanceMetricSchema);
