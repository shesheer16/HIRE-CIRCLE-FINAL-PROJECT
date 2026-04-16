const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema(
    {
        compositeKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        key: {
            type: String,
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        scope: {
            type: String,
            required: true,
            index: true,
        },
        requestHash: {
            type: String,
            required: true,
        },
        responseStatus: {
            type: Number,
            default: null,
        },
        responseBody: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        lockedUntil: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + (24 * 60 * 60 * 1000)),
            index: { expires: 0 },
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
