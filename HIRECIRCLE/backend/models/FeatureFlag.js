const mongoose = require('mongoose');

const featureFlagSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            index: true,
        },
        country: {
            type: String,
            default: null,
            uppercase: true,
            trim: true,
            index: true,
        },
        region: {
            type: String,
            default: null,
            uppercase: true,
            trim: true,
            index: true,
        },
        enabled: {
            type: Boolean,
            default: false,
            index: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        updatedByAdmin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AdminUser',
            default: null,
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

featureFlagSchema.index(
    { key: 1, country: 1, region: 1 },
    { unique: true, sparse: true }
);

module.exports = mongoose.model('FeatureFlag', featureFlagSchema);
