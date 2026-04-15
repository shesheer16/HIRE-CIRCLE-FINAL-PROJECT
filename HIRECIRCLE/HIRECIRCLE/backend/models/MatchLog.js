const mongoose = require('mongoose');

const matchLogSchema = mongoose.Schema(
    {
        matchRunId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MatchRun',
            required: true,
            index: true,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
            index: true,
        },
        finalScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        tier: {
            type: String,
            default: 'REJECT',
        },
        accepted: {
            type: Boolean,
            default: false,
        },
        rejectReason: {
            type: String,
            default: null,
            maxlength: 120,
        },
        rejectionReason: {
            type: String,
            default: null,
            maxlength: 120,
        },
        semanticSkillScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        experienceGaussianScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        economicViabilityScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        roleBonusApplied: {
            type: Boolean,
            default: false,
        },
        isTerminal: {
            type: Boolean,
            default: true,
        },
        explainability: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        matchModelVersionUsed: {
            type: String,
            default: null,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        strict: true,
    }
);

matchLogSchema.index({ matchRunId: 1, workerId: 1, jobId: 1 }, { unique: true });
matchLogSchema.index({ workerId: 1, finalScore: -1 });

const preventMutableUpdates = function preventMutableUpdates(next) {
    next(new Error('MATCH_LOG_IMMUTABLE'));
};

matchLogSchema.pre('save', function preventSaveMutation(next) {
    if (!this.isNew) {
        return next(new Error('MATCH_LOG_IMMUTABLE'));
    }
    return next();
});

matchLogSchema.pre('updateOne', preventMutableUpdates);
matchLogSchema.pre('updateMany', preventMutableUpdates);
matchLogSchema.pre('findOneAndUpdate', preventMutableUpdates);
matchLogSchema.pre('findOneAndReplace', preventMutableUpdates);
matchLogSchema.pre('replaceOne', preventMutableUpdates);

module.exports = mongoose.model('MatchLog', matchLogSchema);
