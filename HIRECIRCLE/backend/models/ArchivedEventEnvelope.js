const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const archivedEventEnvelopeSchema = new mongoose.Schema(
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
            trim: true,
        },
        entityId: {
            type: String,
            default: null,
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
        },
        source: {
            type: String,
            default: 'unknown',
            trim: true,
        },
        archivedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        versionKey: false,
        timestamps: false,
    }
);

archivedEventEnvelopeSchema.index({ timestampUTC: 1, archivedAt: 1 });
applyAppendOnlyGuards(archivedEventEnvelopeSchema);

module.exports = mongoose.model('ArchivedEventEnvelope', archivedEventEnvelopeSchema);

