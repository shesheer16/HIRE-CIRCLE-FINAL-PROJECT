const mongoose = require('mongoose');

const legalConfigSchema = new mongoose.Schema(
    {
        country: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            index: true,
        },
        termsURL: {
            type: String,
            required: true,
            trim: true,
        },
        privacyURL: {
            type: String,
            required: true,
            trim: true,
        },
        complianceFlags: {
            type: [String],
            default: [],
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

legalConfigSchema.index({ country: 1 }, { unique: true });

module.exports = mongoose.model('LegalConfig', legalConfigSchema);
