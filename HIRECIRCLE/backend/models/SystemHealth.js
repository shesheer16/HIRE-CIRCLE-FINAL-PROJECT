const mongoose = require('mongoose');

const systemHealthSchema = new mongoose.Schema(
    {
        serviceName: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['healthy', 'degraded', 'critical'],
            required: true,
            default: 'healthy',
            index: true,
        },
        latency: {
            type: Number,
            default: 0,
            min: 0,
        },
        errorRate: {
            type: Number,
            default: 0,
            min: 0,
        },
        lastCheckedAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
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

systemHealthSchema.index({ status: 1, lastCheckedAt: -1 });

module.exports = mongoose.model('SystemHealth', systemHealthSchema);
