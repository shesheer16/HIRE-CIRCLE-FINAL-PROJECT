const mongoose = require('mongoose');

const matchSnapshotSchema = mongoose.Schema(
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
            default: null,
            index: true,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        deterministicScore: {
            type: Number,
            default: 0,
            index: true,
        },
        probabilisticScore: {
            type: Number,
            default: 0,
            index: true,
        },
        matchScore: {
            type: Number,
            default: 0,
        },
        reliabilityScore: {
            type: Number,
            default: 0,
        },
        employerTier: {
            type: String,
            enum: ['Platinum', 'Gold', 'Silver', 'Standard', 'Unknown'],
            default: 'Unknown',
        },
        workerEngagementScore: {
            type: Number,
            default: 0,
        },
        cityLiquidityScore: {
            type: Number,
            default: 0,
        },
        retentionOutcome: {
            type: String,
            enum: ['unknown', 'retained_30d', 'churned_before_30d'],
            default: 'unknown',
            index: true,
        },
        timeToFillDays: {
            type: Number,
            default: 0,
        },
        cityDensity: {
            type: Number,
            default: 0,
        },
        salaryBand: {
            type: String,
            default: 'unknown',
            index: true,
        },
        shiftType: {
            type: String,
            default: 'unknown',
        },
        city: {
            type: String,
            default: 'unknown',
            index: true,
        },
        snapshotAt: {
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

matchSnapshotSchema.index({ city: 1, snapshotAt: -1 });
matchSnapshotSchema.index({ retentionOutcome: 1, snapshotAt: -1 });

module.exports = mongoose.model('MatchSnapshot', matchSnapshotSchema);
