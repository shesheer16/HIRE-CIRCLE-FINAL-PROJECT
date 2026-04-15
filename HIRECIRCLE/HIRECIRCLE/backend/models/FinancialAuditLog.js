const mongoose = require('mongoose');

const financialAuditLogSchema = new mongoose.Schema(
    {
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        actionType: {
            type: String,
            required: true,
            index: true,
        },
        referenceId: {
            type: String,
            required: true,
            index: true,
        },
        previousState: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            default: {},
        },
        newState: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            default: {},
        },
        timestamp: {
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
        timestamps: false,
    }
);

const immutableError = (next) => next(new Error('FinancialAuditLog is immutable'));

financialAuditLogSchema.pre('updateOne', immutableError);
financialAuditLogSchema.pre('updateMany', immutableError);
financialAuditLogSchema.pre('findOneAndUpdate', immutableError);
financialAuditLogSchema.pre('deleteOne', immutableError);
financialAuditLogSchema.pre('deleteMany', immutableError);
financialAuditLogSchema.pre('findOneAndDelete', immutableError);

financialAuditLogSchema.index({ actionType: 1, timestamp: -1 });

module.exports = mongoose.model('FinancialAuditLog', financialAuditLogSchema);
