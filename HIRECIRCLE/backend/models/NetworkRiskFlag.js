const mongoose = require('mongoose');

const networkRiskFlagSchema = new mongoose.Schema(
    {
        flagType: {
            type: String,
            enum: [
                'fake_review_ring',
                'endorsement_cluster',
                'coordinated_boosting',
                'referral_manipulation',
                'suspicious_trust_loop',
            ],
            required: true,
            index: true,
        },
        users: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'User',
            default: [],
            index: true,
        },
        severity: {
            type: Number,
            min: 0,
            max: 100,
            required: true,
            index: true,
        },
        signalScore: {
            type: Number,
            min: 0,
            max: 100,
            required: true,
        },
        status: {
            type: String,
            enum: ['open', 'reviewing', 'resolved', 'dismissed'],
            default: 'open',
            index: true,
        },
        summary: {
            type: String,
            default: '',
            trim: true,
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

networkRiskFlagSchema.index({ status: 1, severity: -1, createdAt: -1 });
networkRiskFlagSchema.index({ flagType: 1, createdAt: -1 });

module.exports = mongoose.model('NetworkRiskFlag', networkRiskFlagSchema);
