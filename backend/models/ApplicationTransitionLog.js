const mongoose = require('mongoose');

const applicationTransitionLogSchema = new mongoose.Schema(
    {
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        workerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            index: true,
        },
        previousStatus: {
            type: String,
            required: true,
            index: true,
        },
        nextStatus: {
            type: String,
            required: true,
            index: true,
        },
        actorType: {
            type: String,
            enum: ['employer', 'worker', 'candidate', 'automation', 'system'],
            default: 'system',
            index: true,
        },
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        reason: {
            type: String,
            default: 'manual_update',
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'application_transition_logs',
    }
);

applicationTransitionLogSchema.index({ applicationId: 1, createdAt: -1 });
applicationTransitionLogSchema.index({ employerId: 1, createdAt: -1 });
applicationTransitionLogSchema.index({ workerId: 1, createdAt: -1 });
applicationTransitionLogSchema.index({ nextStatus: 1, createdAt: -1 });

module.exports = mongoose.model('ApplicationTransitionLog', applicationTransitionLogSchema);

