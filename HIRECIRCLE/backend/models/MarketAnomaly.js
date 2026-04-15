const mongoose = require('mongoose');

const marketAnomalySchema = mongoose.Schema(
    {
        type: {
            type: String,
            enum: [
                'SUDDEN_EMPLOYER_DROP',
                'WORKER_INACTIVITY_SPIKE',
                'SALARY_INFLATION',
                'MASS_PROFILE_CREATION_IP_CLUSTER',
                'CITY_UNDER_SUPPLIED',
                'CITY_OVER_SUPPLIED',
                'OTP_ABUSE_SPIKE',
                'MESSAGE_SPAM_BURST',
                'FAKE_JOB_PATTERN',
                'DUPLICATE_ACCOUNT_PATTERN',
                'BOT_LIKE_ACTIVITY',
            ],
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: 'global',
            index: true,
        },
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium',
            index: true,
        },
        value: {
            type: Number,
            default: 0,
        },
        baseline: {
            type: Number,
            default: 0,
        },
        threshold: {
            type: Number,
            default: 0,
        },
        detectedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        signature: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        message: {
            type: String,
            default: '',
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

marketAnomalySchema.index({ city: 1, detectedAt: -1 });
marketAnomalySchema.index({ severity: 1, detectedAt: -1 });

module.exports = mongoose.model('MarketAnomaly', marketAnomalySchema);
