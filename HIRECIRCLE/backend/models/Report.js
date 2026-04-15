const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
    {
        reporterId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        targetType: {
            type: String,
            enum: ['user', 'job', 'post', 'message', 'circle', 'circle_post', 'application', 'bounty', 'other'],
            required: true,
            index: true,
        },
        targetId: {
            type: String,
            required: true,
            index: true,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'removed', 'dismissed'],
            default: 'pending',
            index: true,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AdminUser',
            default: null,
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
        resolutionNotes: {
            type: String,
            default: '',
            trim: true,
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

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
