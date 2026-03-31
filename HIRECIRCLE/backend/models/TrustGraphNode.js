const mongoose = require('mongoose');

const NODE_TYPES = [
    'User',
    'Employer',
    'Job',
    'Hire',
    'Referral',
    'EscrowCompletion',
];

const trustGraphNodeSchema = new mongoose.Schema(
    {
        nodeType: {
            type: String,
            enum: NODE_TYPES,
            required: true,
            index: true,
        },
        externalId: {
            type: String,
            required: true,
            index: true,
        },
        ownerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
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

trustGraphNodeSchema.index({ nodeType: 1, externalId: 1 }, { unique: true });

module.exports = {
    TrustGraphNode: mongoose.model('TrustGraphNode', trustGraphNodeSchema),
    TRUST_GRAPH_NODE_TYPES: NODE_TYPES,
};
