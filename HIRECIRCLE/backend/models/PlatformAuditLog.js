const crypto = require('crypto');
const mongoose = require('mongoose');

const platformAuditLogSchema = new mongoose.Schema(
    {
        eventType: {
            type: String,
            required: true,
            index: true,
        },
        actorType: {
            type: String,
            enum: ['system', 'api_key', 'user', 'admin', 'agent', 'integration'],
            default: 'system',
            index: true,
        },
        actorId: {
            type: String,
            default: null,
            index: true,
        },
        apiKeyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ApiKey',
            default: null,
            index: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        route: {
            type: String,
            default: null,
            index: true,
        },
        method: {
            type: String,
            default: null,
        },
        resourceType: {
            type: String,
            default: null,
            index: true,
        },
        resourceId: {
            type: String,
            default: null,
            index: true,
        },
        action: {
            type: String,
            default: null,
            index: true,
        },
        status: {
            type: Number,
            default: null,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        immutableHash: {
            type: String,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

const buildImmutableHash = (doc) => {
    const material = [
        String(doc.eventType || ''),
        String(doc.actorType || ''),
        String(doc.actorId || ''),
        String(doc.apiKeyId || ''),
        String(doc.tenantId || ''),
        String(doc.route || ''),
        String(doc.method || ''),
        String(doc.resourceType || ''),
        String(doc.resourceId || ''),
        String(doc.action || ''),
        String(doc.status || ''),
        JSON.stringify(doc.metadata || {}),
        String(doc.createdAt ? new Date(doc.createdAt).toISOString() : ''),
        crypto.randomUUID(),
    ].join('|');

    return crypto.createHash('sha256').update(material).digest('hex');
};

platformAuditLogSchema.pre('validate', function attachImmutableHash(next) {
    if (!this.immutableHash) {
        this.immutableHash = buildImmutableHash(this);
    }
    next();
});

const rejectMutableAuditOperation = function rejectMutableAuditOperation(next) {
    next(new Error('PlatformAuditLog is append-only and immutable'));
};

platformAuditLogSchema.pre('findOneAndUpdate', rejectMutableAuditOperation);
platformAuditLogSchema.pre('updateOne', rejectMutableAuditOperation);
platformAuditLogSchema.pre('updateMany', rejectMutableAuditOperation);
platformAuditLogSchema.pre('replaceOne', rejectMutableAuditOperation);
platformAuditLogSchema.pre('findOneAndDelete', rejectMutableAuditOperation);
platformAuditLogSchema.pre('deleteOne', rejectMutableAuditOperation);
platformAuditLogSchema.pre('deleteMany', rejectMutableAuditOperation);

platformAuditLogSchema.index({ createdAt: -1, eventType: 1 });
platformAuditLogSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
platformAuditLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformAuditLog', platformAuditLogSchema);
