const mongoose = require('mongoose');

const oauthTokenSchema = new mongoose.Schema(
    {
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        providerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'OAuthProvider',
            required: true,
            index: true,
        },
        accessTokenEncrypted: {
            type: String,
            required: true,
            select: false,
        },
        refreshTokenEncrypted: {
            type: String,
            default: null,
            select: false,
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true,
        },
        scope: {
            type: [String],
            default: [],
        },
        tokenType: {
            type: String,
            default: 'Bearer',
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

oauthTokenSchema.index({ ownerId: 1, providerId: 1, createdAt: -1 });

module.exports = mongoose.model('OAuthToken', oauthTokenSchema);
