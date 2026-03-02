const mongoose = require('mongoose');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const EVENT_TYPES = [
    'user_signup',
    'job_post',
    'application_submit',
    'interview_complete',
    'message_sent',
    'call_started',
    'bounty_created',
];

const eventSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: EVENT_TYPES,
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        meta: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        createdAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        versionKey: false,
    }
);

eventSchema.index({ type: 1, createdAt: -1 });
eventSchema.index({ userId: 1, createdAt: -1 });

eventSchema.post('save', (doc) => {
    safeEmitEventEnvelope({
        eventId: `event-${String(doc._id)}`,
        eventType: doc.type || 'platform_event',
        actorId: doc.userId ? String(doc.userId) : null,
        entityId: doc._id ? String(doc._id) : null,
        metadata: doc.meta || {},
        timestampUTC: doc.createdAt || new Date(),
        source: 'Event',
    });
});

module.exports = {
    Event: mongoose.model('Event', eventSchema),
    EVENT_TYPES,
};
