const mongoose = require('mongoose');

const ABUSE_SIGNAL_TYPES = [
    'mass_job_posting_spam',
    'bot_like_apply_behavior',
    'suspicious_otp_attempts',
    'rapid_account_creation',
    'duplicate_profile_pattern',
];

const abuseSignalSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        signalType: {
            type: String,
            enum: ABUSE_SIGNAL_TYPES,
            required: true,
            index: true,
        },
        score: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            index: true,
        },
        status: {
            type: String,
            enum: ['open', 'blocked', 'resolved'],
            default: 'open',
            index: true,
        },
        blocked: {
            type: Boolean,
            default: false,
            index: true,
        },
        reason: {
            type: String,
            default: '',
            trim: true,
        },
        evidence: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        detectedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

abuseSignalSchema.index({ userId: 1, signalType: 1, detectedAt: -1 });

module.exports = {
    AbuseSignal: mongoose.model('AbuseSignal', abuseSignalSchema),
    ABUSE_SIGNAL_TYPES,
};
