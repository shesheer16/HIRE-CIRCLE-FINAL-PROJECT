const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    referrerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },
    referredUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        sparse: true,
        index: true,
    },
    rewardType: {
        type: String,
        enum: ['credit_unlock', 'referral_bonus', 'premium_unlock'],
        default: 'credit_unlock',
    },
    referrer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },
    job: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        default: null,
    },
    bounty: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bounty',
        default: null,
        index: true,
    },
    candidateName: {
        type: String,
        default: '',
        trim: true,
    },
    candidateContact: {
        type: String,
        default: '',
        trim: true,
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'rejected'],
        default: 'pending',
        index: true,
    },
    depth: {
        type: Number,
        default: 1,
        min: 1,
        max: 12,
        index: true,
    },
    chainSignature: {
        type: String,
        default: null,
        index: true,
    },
    reward: {
        type: Number,
        default: 0,
    },
    completedAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
});

referralSchema.pre('save', function preSaveReferral(next) {
    if (!this.referrerId && this.referrer) {
        this.referrerId = this.referrer;
    }
    if (!this.referrer && this.referrerId) {
        this.referrer = this.referrerId;
    }
    if (typeof next === 'function') {
        next();
    }
});

referralSchema.index({ referrerId: 1, createdAt: -1 });
referralSchema.index({ referrer: 1, createdAt: -1 });
referralSchema.index({ referredUserId: 1, status: 1 });
referralSchema.index({ referrerId: 1, job: 1, candidateContact: 1, createdAt: -1 });
referralSchema.index({ referrerId: 1, bounty: 1, candidateContact: 1, createdAt: -1 });
referralSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Referral', referralSchema);
