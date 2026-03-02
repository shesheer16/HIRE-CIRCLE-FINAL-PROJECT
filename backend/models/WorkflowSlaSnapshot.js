const mongoose = require('mongoose');

const workflowSlaSnapshotSchema = new mongoose.Schema(
    {
        scopeType: {
            type: String,
            enum: ['global', 'employer', 'candidate'],
            required: true,
            default: 'global',
            index: true,
        },
        scopeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        employerResponseTimeHours: {
            type: Number,
            default: 0,
            min: 0,
        },
        candidateResponseTimeHours: {
            type: Number,
            default: 0,
            min: 0,
        },
        averageHiringTimeHours: {
            type: Number,
            default: 0,
            min: 0,
        },
        sampleSize: {
            type: Number,
            default: 0,
            min: 0,
        },
        computedAt: {
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
        collection: 'workflow_sla_snapshots',
    }
);

workflowSlaSnapshotSchema.index({ scopeType: 1, scopeId: 1 }, { unique: true });
workflowSlaSnapshotSchema.index({ computedAt: -1, scopeType: 1 });

module.exports = mongoose.model('WorkflowSlaSnapshot', workflowSlaSnapshotSchema);

