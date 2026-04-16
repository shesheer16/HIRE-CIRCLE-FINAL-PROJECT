const mongoose = require('mongoose');

const agentExecutionLogSchema = new mongoose.Schema(
    {
        agentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Agent',
            required: true,
            index: true,
        },
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        scope: {
            type: String,
            required: true,
            index: true,
        },
        requestedAction: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ['allowed', 'blocked', 'completed', 'failed'],
            required: true,
            index: true,
        },
        approvalRequired: {
            type: Boolean,
            default: false,
        },
        piiAccessRequested: {
            type: Boolean,
            default: false,
        },
        piiAccessGranted: {
            type: Boolean,
            default: false,
        },
        durationMs: {
            type: Number,
            default: 0,
            min: 0,
        },
        inputPreview: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        resultPreview: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        error: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

agentExecutionLogSchema.index({ tenantId: 1, createdAt: -1 });
agentExecutionLogSchema.index({ actorId: 1, createdAt: -1 });

module.exports = mongoose.model('AgentExecutionLog', agentExecutionLogSchema);
