const mongoose = require('mongoose');

const hiringTrajectoryModelSchema = mongoose.Schema(
    {
        entityType: {
            type: String,
            enum: ['worker', 'employer'],
            required: true,
            index: true,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: 'unknown',
            index: true,
        },
        trajectoryScore: {
            type: Number,
            default: 0,
            index: true,
        },
        workerEarningPath: {
            in30d: { type: Number, default: 0 },
            in90d: { type: Number, default: 0 },
            in180d: { type: Number, default: 0 },
        },
        employerHiringSuccessPath: {
            in30d: { type: Number, default: 0 },
            in90d: { type: Number, default: 0 },
            in180d: { type: Number, default: 0 },
        },
        confidenceScore: {
            type: Number,
            default: 0,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        factors: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        anonymizedPatternContext: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

hiringTrajectoryModelSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
hiringTrajectoryModelSchema.index({ city: 1, trajectoryScore: -1 });

module.exports = mongoose.model('HiringTrajectoryModel', hiringTrajectoryModelSchema);
