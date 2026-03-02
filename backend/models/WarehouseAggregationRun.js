const mongoose = require('mongoose');

const warehouseAggregationRunSchema = new mongoose.Schema(
    {
        jobName: {
            type: String,
            required: true,
            index: true,
        },
        windowKey: {
            type: String,
            required: true,
            index: true,
        },
        runToken: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['running', 'completed', 'failed'],
            required: true,
            default: 'running',
            index: true,
        },
        source: {
            type: String,
            default: 'scheduler',
        },
        attempts: {
            type: Number,
            default: 1,
            min: 1,
        },
        startedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        lastError: {
            type: String,
            default: null,
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

warehouseAggregationRunSchema.index({ jobName: 1, windowKey: 1 }, { unique: true });

module.exports = mongoose.model('WarehouseAggregationRun', warehouseAggregationRunSchema);

