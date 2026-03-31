const mongoose = require('mongoose');

const HIRE_RATING_TIMEOUT_HOURS = Number.parseInt(process.env.HIRE_RATING_TIMEOUT_HOURS || '72', 10);

const buildRevealAt = () => new Date(Date.now() + (Math.max(1, HIRE_RATING_TIMEOUT_HOURS) * 60 * 60 * 1000));

const hireRecordSchema = new mongoose.Schema(
    {
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
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        success: {
            type: Boolean,
            default: true,
            index: true,
        },
        ratingFromEmployer: {
            type: Number,
            min: 1,
            max: 5,
            default: null,
        },
        ratingFromWorker: {
            type: Number,
            min: 1,
            max: 5,
            default: null,
        },
        employerRatingSubmittedAt: {
            type: Date,
            default: null,
        },
        workerRatingSubmittedAt: {
            type: Date,
            default: null,
        },
        ratingRevealAt: {
            type: Date,
            default: buildRevealAt,
            index: true,
        },
        ratingsVisible: {
            type: Boolean,
            default: false,
            index: true,
        },
        completionTimestamp: {
            type: Date,
            required: true,
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

hireRecordSchema.index({ jobId: 1, workerId: 1 }, { unique: true });
hireRecordSchema.index({ employerId: 1, completionTimestamp: -1 });
hireRecordSchema.index({ workerId: 1, completionTimestamp: -1 });

module.exports = mongoose.model('HireRecord', hireRecordSchema);
