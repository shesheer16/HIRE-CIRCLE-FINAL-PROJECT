const mongoose = require('mongoose');

const experimentSchema = mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        variantA: {
            type: String,
            required: true,
            default: 'A',
            trim: true,
        },
        variantB: {
            type: String,
            required: true,
            default: 'B',
            trim: true,
        },
        userAssignment: {
            type: Map,
            of: String,
            default: {},
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Experiment', experimentSchema);
