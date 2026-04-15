const mongoose = require('mongoose');

const AGENT_SCOPES = [
    'job_description_optimization',
    'candidate_screening',
    'salary_benchmarking',
    'talent_pool_analysis',
    'interview_question_generation',
];

const agentSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        version: {
            type: String,
            required: true,
            default: '1.0.0',
            trim: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        owner: {
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
            enum: AGENT_SCOPES,
            required: true,
            index: true,
        },
        permissions: {
            canReadPii: {
                type: Boolean,
                default: false,
            },
            canMutateCriticalRecords: {
                type: Boolean,
                default: false,
            },
            requiresApprovalForMutations: {
                type: Boolean,
                default: true,
            },
            allowedDataScopes: {
                type: [String],
                default: [],
            },
        },
        pricing: {
            currency: {
                type: String,
                default: 'USD',
                uppercase: true,
            },
            unitAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            unit: {
                type: String,
                default: 'execution',
            },
        },
        rating: {
            type: Number,
            min: 0,
            max: 5,
            default: 0,
            index: true,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        sandboxMode: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

agentSchema.index({ owner: 1, name: 1, version: 1 }, { unique: true });
agentSchema.statics.AGENT_SCOPES = AGENT_SCOPES;

module.exports = mongoose.model('Agent', agentSchema);
