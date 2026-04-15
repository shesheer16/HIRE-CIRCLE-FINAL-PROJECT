const mongoose = require('mongoose');

const eventEnvelopeSchema = new mongoose.Schema(
    {
        eventId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        eventType: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        actorId: {
            type: String,
            default: null,
            index: true,
            trim: true,
        },
        entityId: {
            type: String,
            default: null,
            index: true,
            trim: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        timestampUTC: {
            type: Date,
            required: true,
            index: true,
            default: Date.now,
        },
        region: {
            type: String,
            default: 'GLOBAL',
            uppercase: true,
            trim: true,
            index: true,
        },
        appVersion: {
            type: String,
            default: 'unknown',
            trim: true,
            index: true,
        },
        source: {
            type: String,
            default: 'unknown',
            trim: true,
        },
    },
    {
        versionKey: false,
        timestamps: { createdAt: 'ingestedAt', updatedAt: false },
    }
);

eventEnvelopeSchema.index({ eventType: 1, timestampUTC: -1 });
eventEnvelopeSchema.index({ actorId: 1, timestampUTC: -1 });
eventEnvelopeSchema.index({ region: 1, timestampUTC: -1 });

module.exports = mongoose.model('EventEnvelope', eventEnvelopeSchema);
