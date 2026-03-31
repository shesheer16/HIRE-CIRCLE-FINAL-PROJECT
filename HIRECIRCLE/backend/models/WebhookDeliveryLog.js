const mongoose = require('mongoose');

const webhookDeliveryLogSchema = new mongoose.Schema(
    {
        webhookId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Webhook',
            required: true,
            index: true,
        },
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            index: true,
        },
        targetUrl: {
            type: String,
            required: true,
            trim: true,
        },
        idempotencyKey: {
            type: String,
            required: true,
            index: true,
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        status: {
            type: String,
            enum: ['queued', 'success', 'failed', 'disabled'],
            default: 'queued',
            index: true,
        },
        responseStatus: {
            type: Number,
            default: null,
        },
        responseBody: {
            type: String,
            default: null,
        },
        latency: {
            type: Number,
            default: null,
        },
        attempt: {
            type: Number,
            default: 0,
            min: 0,
        },
        maxAttempts: {
            type: Number,
            default: 3,
            min: 1,
        },
        nextRetryAt: {
            type: Date,
            default: null,
            index: true,
        },
        lastError: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

webhookDeliveryLogSchema.index({ webhookId: 1, idempotencyKey: 1 }, { unique: true });
webhookDeliveryLogSchema.index({ status: 1, nextRetryAt: 1, updatedAt: 1 });

module.exports = mongoose.model('WebhookDeliveryLog', webhookDeliveryLogSchema);
