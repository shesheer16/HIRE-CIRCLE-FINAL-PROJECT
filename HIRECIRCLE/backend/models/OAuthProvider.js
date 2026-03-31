const mongoose = require('mongoose');

const OAUTH_PROVIDER_TYPES = ['google', 'linkedin', 'enterprise_sso'];

const oauthProviderSchema = new mongoose.Schema(
    {
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        provider: {
            type: String,
            enum: OAUTH_PROVIDER_TYPES,
            required: true,
            index: true,
        },
        clientId: {
            type: String,
            required: true,
        },
        clientSecretRef: {
            type: String,
            default: null,
        },
        authUrl: {
            type: String,
            default: null,
        },
        tokenUrl: {
            type: String,
            default: null,
        },
        scopes: {
            type: [String],
            default: [],
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

oauthProviderSchema.index({ ownerId: 1, provider: 1 }, { unique: true });

module.exports = {
    OAuthProvider: mongoose.model('OAuthProvider', oauthProviderSchema),
    OAUTH_PROVIDER_TYPES,
};
