const mongoose = require('mongoose');

const upsellExposureSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: ['smart_interview_post_confirm'],
            default: 'smart_interview_post_confirm',
        },
        shownAt: {
            type: Date,
            default: Date.now,
        },
        dismissedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

upsellExposureSchema.index({ employerId: 1, jobId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('UpsellExposure', upsellExposureSchema);
