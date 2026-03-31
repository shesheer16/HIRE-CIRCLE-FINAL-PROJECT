const mongoose = require('mongoose');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const piiKeyPattern = /(email|phone|name|address|dob|aadhaar|pan|ssn)/i;

const maskEmail = (value) => {
    const text = String(value || '');
    const [local = '', domain = ''] = text.split('@');
    if (!domain) return '[REDACTED]';
    return `${local.slice(0, 2)}***@${domain}`;
};

const sanitizeMetadataValue = (key, value) => {
    if (value === null || typeof value === 'undefined') return value;
    if (typeof value === 'string') {
        if (piiKeyPattern.test(key) && value.includes('@')) return maskEmail(value);
        if (piiKeyPattern.test(key) && /\\d{8,}/.test(value)) return '[REDACTED]';
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => sanitizeMetadataValue(key, item));
    if (typeof value === 'object') {
        const output = {};
        Object.entries(value).forEach(([childKey, childValue]) => {
            output[childKey] = sanitizeMetadataValue(childKey, childValue);
        });
        return output;
    }
    return value;
};

const analyticsEventSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    eventName: {
        type: String, // e.g., 'signup', 'job_posted', 'match_viewed'
        required: true,
        index: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed // Flexible storage for event context
    }
}, { timestamps: true });

analyticsEventSchema.pre('save', function sanitizePiiInMetadata(next) {
    if (!this.metadata || typeof this.metadata !== 'object') {
        if (typeof next === 'function') return next();
        return;
    }

    const sanitized = {};
    Object.entries(this.metadata).forEach(([key, value]) => {
        sanitized[key] = sanitizeMetadataValue(key, value);
    });
    this.metadata = sanitized;
    if (typeof next === 'function') return next();
    return;
});

analyticsEventSchema.post('save', (doc) => {
    safeEmitEventEnvelope({
        eventId: `analytics-${String(doc._id)}`,
        eventType: doc.eventName || 'analytics_event',
        actorId: doc.user ? String(doc.user) : null,
        entityId: doc._id ? String(doc._id) : null,
        metadata: doc.metadata || {},
        timestampUTC: doc.createdAt || new Date(),
        source: 'AnalyticsEvent',
    });
});

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
