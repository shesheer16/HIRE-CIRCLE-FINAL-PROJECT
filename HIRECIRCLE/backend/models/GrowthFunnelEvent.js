const mongoose = require('mongoose');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const STAGES = ['signup', 'otp', 'interview', 'profile_complete', 'apply', 'interview_completed', 'offer', 'chat', 'hire'];

const growthFunnelEventSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        stage: {
            type: String,
            enum: STAGES,
            required: true,
            index: true,
        },
        source: {
            type: String,
            default: 'system',
            trim: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        occurredAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

growthFunnelEventSchema.index({ user: 1, stage: 1 }, { unique: true });
growthFunnelEventSchema.index({ stage: 1, occurredAt: -1 });

growthFunnelEventSchema.post('save', (doc) => {
    safeEmitEventEnvelope({
        eventId: `funnel-${String(doc._id)}`,
        eventType: 'FUNNEL_STAGE_REACHED',
        actorId: doc.user ? String(doc.user) : null,
        entityId: doc._id ? String(doc._id) : null,
        metadata: {
            stage: doc.stage,
            source: doc.source || 'system',
            ...(doc.metadata || {}),
        },
        timestampUTC: doc.occurredAt || doc.createdAt || new Date(),
        source: 'GrowthFunnelEvent',
    });
});

module.exports = mongoose.model('GrowthFunnelEvent', growthFunnelEventSchema);
module.exports.FUNNEL_STAGES = STAGES;
