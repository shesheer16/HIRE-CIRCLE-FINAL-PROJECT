const mongoose = require('mongoose');

const TEAM_ROLES = ['owner', 'admin', 'recruiter', 'analyst', 'coordinator'];

const enterpriseWorkspaceSchema = new mongoose.Schema(
    {
        ownerEmployerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        organizationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        workspaceName: {
            type: String,
            default: 'Enterprise Workspace',
            trim: true,
        },
        enterpriseVerified: {
            type: Boolean,
            default: false,
            index: true,
        },
        dataIsolationKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        teamMembers: [
            {
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                role: {
                    type: String,
                    enum: TEAM_ROLES,
                    default: 'recruiter',
                },
                invitedAt: {
                    type: Date,
                    default: Date.now,
                },
                active: {
                    type: Boolean,
                    default: true,
                },
            },
        ],
        featureAccess: {
            bulkJobImport: {
                type: Boolean,
                default: true,
            },
            recruiterCollaboration: {
                type: Boolean,
                default: true,
            },
            hiringAnalyticsAccess: {
                type: Boolean,
                default: true,
            },
            slaPriorityRouting: {
                type: Boolean,
                default: true,
            },
        },
        status: {
            type: String,
            enum: ['active', 'paused'],
            default: 'active',
            index: true,
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

enterpriseWorkspaceSchema.index({ organizationId: 1, status: 1 });
enterpriseWorkspaceSchema.index({ ownerEmployerId: 1, status: 1 });
enterpriseWorkspaceSchema.index({ 'teamMembers.userId': 1, status: 1 });

module.exports = {
    EnterpriseWorkspace: mongoose.model('EnterpriseWorkspace', enterpriseWorkspaceSchema),
    ENTERPRISE_TEAM_ROLES: TEAM_ROLES,
};
