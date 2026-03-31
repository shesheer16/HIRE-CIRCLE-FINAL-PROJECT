const mongoose = require('mongoose');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const hiringLifecycleEventSchema = mongoose.Schema(
    {
        eventType: {
            type: String,
            enum: [
                'INTERVIEW_CONFIRMED',
                'APPLICATION_CREATED',
                'APPLICATION_APPLIED',
                'APPLICATION_SHORTLISTED',
                'INTERVIEW_REQUESTED',
                'INTERVIEW_COMPLETED',
                'OFFER_SENT',
                'OFFER_ACCEPTED',
                'OFFER_DECLINED',
                'APPLICATION_HIRED',
                'APPLICATION_REJECTED',
                'APPLICATION_WITHDRAWN',
                'RETENTION_30D',
            ],
            required: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            default: null,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
        },
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            default: null,
        },
        city: {
            type: String,
            default: 'Hyderabad',
            index: true,
        },
        roleCluster: {
            type: String,
            default: 'general',
        },
        salaryBand: {
            type: String,
            default: 'unknown',
        },
        shift: {
            type: String,
            default: 'unknown',
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

hiringLifecycleEventSchema.index({ city: 1, occurredAt: -1, eventType: 1 });
hiringLifecycleEventSchema.index({ eventType: 1, occurredAt: -1 });
hiringLifecycleEventSchema.index({ employerId: 1, occurredAt: -1 });
hiringLifecycleEventSchema.index({ workerId: 1, occurredAt: -1 });
hiringLifecycleEventSchema.index(
    { eventType: 1, applicationId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            eventType: 'RETENTION_30D',
            applicationId: { $type: 'objectId' },
        },
    }
);

hiringLifecycleEventSchema.post('save', (doc) => {
    safeEmitEventEnvelope({
        eventId: `lifecycle-${String(doc._id)}`,
        eventType: doc.eventType || 'HIRING_LIFECYCLE_EVENT',
        actorId: doc.userId ? String(doc.userId) : (doc.employerId ? String(doc.employerId) : null),
        entityId: doc.applicationId ? String(doc.applicationId) : (doc.jobId ? String(doc.jobId) : null),
        metadata: {
            city: doc.city,
            roleCluster: doc.roleCluster,
            salaryBand: doc.salaryBand,
            shift: doc.shift,
            ...(doc.metadata || {}),
        },
        timestampUTC: doc.occurredAt || doc.createdAt || new Date(),
        region: doc.city || null,
        source: 'HiringLifecycleEvent',
    });
});

module.exports = mongoose.model('HiringLifecycleEvent', hiringLifecycleEventSchema);
