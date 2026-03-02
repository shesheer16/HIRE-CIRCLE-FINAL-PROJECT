const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
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
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            index: true,
        },
        salaryOffered: {
            type: Number,
            required: true,
            min: 0,
        },
        terms: {
            type: String,
            required: true,
            maxlength: 5000,
        },
        expiryDate: {
            type: Date,
            required: true,
            index: true,
        },
        escrowEnabled: {
            type: Boolean,
            default: false,
            index: true,
        },
        status: {
            type: String,
            enum: ['sent', 'accepted', 'declined', 'expired', 'cancelled'],
            default: 'sent',
            index: true,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        declinedAt: {
            type: Date,
            default: null,
        },
        expiredAt: {
            type: Date,
            default: null,
        },
        isLocked: {
            type: Boolean,
            default: false,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'offers',
    }
);

offerSchema.index(
    { applicationId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: ['sent', 'accepted'] },
        },
    }
);

offerSchema.index({ employerId: 1, status: 1, createdAt: -1 });
offerSchema.index({ candidateId: 1, status: 1, createdAt: -1 });
offerSchema.index({ status: 1, expiryDate: 1 });

offerSchema.pre('save', function enforceAcceptedLock(next) {
    if (!this.isModified('status')) return next();
    if (this.isLocked && String(this.status || '').toLowerCase() !== 'accepted') {
        return next(new Error('Accepted offer is locked and cannot be changed'));
    }
    return next();
});

module.exports = mongoose.model('Offer', offerSchema);

