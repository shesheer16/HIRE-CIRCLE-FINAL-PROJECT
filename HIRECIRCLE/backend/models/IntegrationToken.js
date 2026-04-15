const mongoose = require('mongoose');

const integrationTokenSchema = new mongoose.Schema(
    {
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        integrationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Integration',
            required: true,
            index: true,
        },
        tokenHash: {
            type: String,
            required: true,
            select: false,
            index: true,
        },
        tokenEncrypted: {
            type: String,
            required: true,
            select: false,
        },
        tokenIv: {
            type: String,
            required: true,
            select: false,
        },
        tokenTag: {
            type: String,
            required: true,
            select: false,
        },
        refreshTokenEncrypted: {
            type: String,
            default: null,
            select: false,
        },
        refreshTokenIv: {
            type: String,
            default: null,
            select: false,
        },
        refreshTokenTag: {
            type: String,
            default: null,
            select: false,
        },
        tokenPrefix: {
            type: String,
            required: true,
            index: true,
        },
        scopes: {
            type: [String],
            default: [],
        },
        revoked: {
            type: Boolean,
            default: false,
            index: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

integrationTokenSchema.index({ integrationId: 1, tokenPrefix: 1 }, { unique: true });

module.exports = mongoose.model('IntegrationToken', integrationTokenSchema);
