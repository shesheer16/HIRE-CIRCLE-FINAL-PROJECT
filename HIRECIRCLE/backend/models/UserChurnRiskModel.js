const mongoose = require('mongoose');

const userChurnRiskModelSchema = mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        inactivityDays: {
            type: Number,
            default: 0,
            min: 0,
        },
        applicationSuccessRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        interviewCompletionRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        engagementScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        churnRiskScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        churnRiskLevel: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            default: 'LOW',
            index: true,
        },
        recommendedAction: {
            type: String,
            enum: ['none', 'targeted_nudge', 'smart_notification', 'contextual_reminder'],
            default: 'none',
        },
        lastNudgeAt: {
            type: Date,
            default: null,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        explainability: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'user_churn_risks',
    }
);

userChurnRiskModelSchema.index({ churnRiskLevel: 1, churnRiskScore: -1, computedAt: -1 });

module.exports = mongoose.model('UserChurnRiskModel', userChurnRiskModelSchema);
