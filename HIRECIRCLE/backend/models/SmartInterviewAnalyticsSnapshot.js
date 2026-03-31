const mongoose = require('mongoose');

const smartInterviewAnalyticsSnapshotSchema = mongoose.Schema(
    {
        role: {
            type: String,
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: 'unknown',
            index: true,
        },
        experience: {
            type: Number,
            default: null,
        },
        salary: {
            type: Number,
            default: null,
        },
        clarityScore: {
            type: Number,
            default: null,
            min: 0,
            max: 1,
        },
        hireOutcome: {
            type: String,
            enum: ['unknown', 'shortlisted', 'hired', 'rejected'],
            default: 'unknown',
            index: true,
        },
        retention30d: {
            type: Boolean,
            default: false,
            index: true,
        },
        source: {
            type: String,
            default: 'smart_interview_v4',
            index: true,
        },
        capturedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'smart_interview_analytics_snapshots',
    }
);

smartInterviewAnalyticsSnapshotSchema.index({ role: 1, city: 1, capturedAt: -1 });
smartInterviewAnalyticsSnapshotSchema.index({ hireOutcome: 1, retention30d: 1, capturedAt: -1 });

module.exports = mongoose.model('SmartInterviewAnalyticsSnapshot', smartInterviewAnalyticsSnapshotSchema);
