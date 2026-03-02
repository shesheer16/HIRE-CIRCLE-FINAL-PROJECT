const mongoose = require('mongoose');

const EDGE_TYPES = [
    'hired_by',
    'referred_by',
    'worked_with',
    'paid_successfully',
    'endorsed_by',
    // New deterministic trust graph edge types (kept alongside legacy values).
    'hired',
    'endorsed',
    'messaged',
    'referred',
    'collaborated',
    'community_interaction',
];

const trustGraphEdgeSchema = new mongoose.Schema(
    {
        fromNode: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TrustGraphNode',
            required: true,
            index: true,
        },
        toNode: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TrustGraphNode',
            required: true,
            index: true,
        },
        edgeType: {
            type: String,
            enum: EDGE_TYPES,
            required: true,
            index: true,
        },
        edgeKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        weight: {
            type: Number,
            default: 1,
            min: 0,
            max: 10,
        },
        occurredAt: {
            type: Date,
            default: Date.now,
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

trustGraphEdgeSchema.index({ edgeType: 1, occurredAt: -1 });
trustGraphEdgeSchema.index({ fromNode: 1, edgeType: 1, occurredAt: -1 });
trustGraphEdgeSchema.index({ toNode: 1, edgeType: 1, occurredAt: -1 });

module.exports = {
    TrustGraphEdge: mongoose.model('TrustGraphEdge', trustGraphEdgeSchema),
    TRUST_GRAPH_EDGE_TYPES: EDGE_TYPES,
};
