const mongoose = require('mongoose');

const webhookEventLogSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            enum: ['stripe', 'razorpay'],
            required: true,
            index: true,
        },
        eventId: {
            type: String,
            required: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
        },
        processedAt: {
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

webhookEventLogSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('WebhookEventLog', webhookEventLogSchema);
