const mongoose = require('mongoose');

const systemAlertSchema = new mongoose.Schema(
    {
        alertType: {
            type: String,
            required: true,
            index: true,
            default: 'system_event',
        },
        severity: {
            type: String,
            enum: ['info', 'warning', 'critical'],
            default: 'warning',
            required: true,
            index: true,
        },
        source: {
            type: String,
            required: true,
            default: 'system',
            index: true,
        },
        message: {
            type: String,
            required: true,
            default: 'System alert',
            trim: true,
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
        acknowledged: {
            type: Boolean,
            default: false,
            index: true,
        },
        acknowledgedAt: {
            type: Date,
            default: null,
        },
        metric: {
            type: String,
            required: true,
            default: 'generic_metric',
        },
        value: {
            type: Number,
            default: 0,
        },
        threshold: {
            type: Number,
            default: 0,
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

systemAlertSchema.index({ createdAt: -1, severity: 1 });
systemAlertSchema.index({ timestamp: -1, acknowledged: 1 });

module.exports = mongoose.model('SystemAlert', systemAlertSchema);
