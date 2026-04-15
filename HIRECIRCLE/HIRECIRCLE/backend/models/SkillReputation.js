const mongoose = require('mongoose');

const skillReputationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        skill: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        score: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
        },
        verifiedByHireCompletion: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        endorsedByEmployers: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        repeatedSuccessfulContracts: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        signalCounts: {
            completedHires: {
                type: Number,
                default: 0,
                min: 0,
            },
            endorsements: {
                type: Number,
                default: 0,
                min: 0,
            },
            repeatedContracts: {
                type: Number,
                default: 0,
                min: 0,
            },
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
    }
);

skillReputationSchema.index({ userId: 1, skill: 1 }, { unique: true });
skillReputationSchema.index({ userId: 1, score: -1 });

module.exports = mongoose.model('SkillReputation', skillReputationSchema);
