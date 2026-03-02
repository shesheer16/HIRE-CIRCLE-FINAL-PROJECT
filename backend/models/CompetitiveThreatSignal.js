const mongoose = require('mongoose');

const competitiveThreatSignalSchema = mongoose.Schema(
    {
        type: {
            type: String,
            enum: [
                'CITY_FILL_RATE_DROP',
                'EMPLOYER_CHURN_SPIKE',
                'API_USAGE_ANOMALY',
                'WORKER_ENGAGEMENT_DROP',
            ],
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: 'global',
            index: true,
        },
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium',
            index: true,
        },
        value: {
            type: Number,
            default: 0,
        },
        baseline: {
            type: Number,
            default: 0,
        },
        threshold: {
            type: Number,
            default: 0,
        },
        signature: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        message: {
            type: String,
            default: '',
        },
        status: {
            type: String,
            enum: ['open', 'acknowledged', 'resolved'],
            default: 'open',
            index: true,
        },
        detectedAt: {
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

competitiveThreatSignalSchema.index({ city: 1, detectedAt: -1 });
competitiveThreatSignalSchema.index({ severity: 1, status: 1, detectedAt: -1 });

module.exports = mongoose.model('CompetitiveThreatSignal', competitiveThreatSignalSchema);
