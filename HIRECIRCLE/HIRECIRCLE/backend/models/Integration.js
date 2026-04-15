const mongoose = require('mongoose');

const INTEGRATION_TYPES = [
    'SLACK',
    'EMAIL_AUTOMATION',
    'CALENDAR_SYNC',
    'CRM_EXPORT',
    'PAYROLL',
    'BACKGROUND_CHECK',
    'ATS',
    'CRM',
    'HRIS',
];
const INTEGRATION_STATUSES = ['active', 'paused', 'error', 'revoked'];

const integrationSchema = new mongoose.Schema(
    {
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        name: {
            type: String,
            default: 'Integration',
            trim: true,
        },
        type: {
            type: String,
            enum: INTEGRATION_TYPES,
            required: true,
            index: true,
        },
        connector: {
            type: String,
            enum: [
                'slack',
                'email_automation',
                'calendar_sync',
                'crm_export',
                'payroll',
                'background_check',
                'generic_ats_sync',
                'generic_hris_push',
                'generic_crm_sync',
            ],
            required: true,
            index: true,
        },
        provider: {
            type: String,
            default: 'generic',
            trim: true,
            index: true,
        },
        oauthSafe: {
            type: Boolean,
            default: true,
        },
        encryptedTokens: {
            type: Boolean,
            default: true,
        },
        revokable: {
            type: Boolean,
            default: true,
        },
        scopes: {
            type: [String],
            default: [],
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        config: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        status: {
            type: String,
            enum: INTEGRATION_STATUSES,
            default: 'active',
            index: true,
        },
        lastSync: {
            type: Date,
            default: null,
        },
        syncError: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

integrationSchema.index({ ownerId: 1, type: 1, status: 1 });

module.exports = {
    Integration: mongoose.model('Integration', integrationSchema),
    INTEGRATION_TYPES,
    INTEGRATION_STATUSES,
};
