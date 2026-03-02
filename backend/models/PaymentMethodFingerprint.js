const mongoose = require('mongoose');

const paymentMethodFingerprintSchema = new mongoose.Schema(
    {
        fingerprint: {
            type: String,
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        paymentRecordId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PaymentRecord',
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

paymentMethodFingerprintSchema.index({ fingerprint: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PaymentMethodFingerprint', paymentMethodFingerprintSchema);
