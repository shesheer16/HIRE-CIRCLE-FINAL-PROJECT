const mongoose = require('mongoose');

const userNetworkScoreSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        referrals: {
            type: Number,
            default: 0,
        },
        posts: {
            type: Number,
            default: 0,
        },
        responses: {
            type: Number,
            default: 0,
        },
        hires: {
            type: Number,
            default: 0,
        },
        engagement: {
            type: Number,
            default: 0,
        },
        score: {
            type: Number,
            default: 0,
            index: true,
        },
        computedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('UserNetworkScore', userNetworkScoreSchema);
