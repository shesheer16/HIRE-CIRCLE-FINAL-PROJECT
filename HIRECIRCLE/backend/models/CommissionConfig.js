const mongoose = require('mongoose');

const commissionConfigSchema = new mongoose.Schema(
    {
        percentage: {
            type: Number,
            required: true,
            default: 10,
            min: 0,
            max: 100,
        },
        flatFee: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        planTypeBased: {
            free: {
                percentage: { type: Number, min: 0, max: 100, default: 10 },
                flatFee: { type: Number, min: 0, default: 0 },
            },
            pro: {
                percentage: { type: Number, min: 0, max: 100, default: 8 },
                flatFee: { type: Number, min: 0, default: 0 },
            },
            enterprise: {
                percentage: { type: Number, min: 0, max: 100, default: 5 },
                flatFee: { type: Number, min: 0, default: 0 },
            },
        },
        isActive: {
            type: Boolean,
            required: true,
            default: true,
        },
        effectiveFrom: {
            type: Date,
            required: true,
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

commissionConfigSchema.index(
    { isActive: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
    }
);

module.exports = mongoose.model('CommissionConfig', commissionConfigSchema);
