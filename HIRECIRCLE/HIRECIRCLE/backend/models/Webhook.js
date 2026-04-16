const mongoose = require('mongoose');

const WEBHOOK_EVENT_TYPES = [
    'application.received',
    'interview.scheduled',
    'offer.accepted',
    'hire.completed',
    'job.created',
    'job.closed',
    'application.submitted',
    'application.accepted',
    'interview.completed',
    'escrow.released',
    'subscription.updated',
];

const webhookSchema = new mongoose.Schema(
    {
        ownerId: {
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
        eventType: {
            type: String,
            enum: WEBHOOK_EVENT_TYPES,
            required: true,
            index: true,
        },
        targetUrl: {
            type: String,
            required: true,
            trim: true,
        },
        secret: {
            type: String,
            required: true,
            select: false,
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
        consecutiveFailures: {
            type: Number,
            default: 0,
            min: 0,
        },
        failureThreshold: {
            type: Number,
            default: 3,
            min: 1,
            max: 25,
        },
        disabledAt: {
            type: Date,
            default: null,
        },
        lastDeliveryAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

webhookSchema.index({ ownerId: 1, eventType: 1, active: 1 });

module.exports = {
    Webhook: mongoose.model('Webhook', webhookSchema),
    WEBHOOK_EVENT_TYPES,
};
