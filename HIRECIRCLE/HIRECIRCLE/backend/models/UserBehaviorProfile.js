const mongoose = require('mongoose');

const userBehaviorProfileSchema = mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        responseTimeAvg: {
            type: Number,
            default: 0,
        },
        completionRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        reliabilityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        engagementScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        dropOffPoints: {
            type: [String],
            default: [],
        },
        transparency: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'user_behavior_profiles',
    }
);

userBehaviorProfileSchema.index({ reliabilityScore: -1, engagementScore: -1, computedAt: -1 });

module.exports = mongoose.model('UserBehaviorProfile', userBehaviorProfileSchema);
