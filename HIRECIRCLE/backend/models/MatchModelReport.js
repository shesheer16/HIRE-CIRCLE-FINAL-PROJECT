const mongoose = require('mongoose');

const matchModelReportSchema = mongoose.Schema(
    {
        modelVersion: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        aggregateMetrics: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        perClusterMetrics: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        activationGate: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        activated: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['trained', 'skipped', 'failed'],
            default: 'trained',
        },
        notes: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

matchModelReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MatchModelReport', matchModelReportSchema);
