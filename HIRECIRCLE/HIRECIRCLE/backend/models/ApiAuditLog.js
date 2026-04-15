const mongoose = require('mongoose');

const apiAuditLogSchema = new mongoose.Schema(
    {
        apiKeyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ApiKey',
            default: null,
            index: true,
        },
        endpoint: {
            type: String,
            required: true,
            index: true,
        },
        ip: {
            type: String,
            default: 'unknown',
            index: true,
        },
        responseStatus: {
            type: Number,
            required: true,
            index: true,
        },
        latency: {
            type: Number,
            required: true,
        },
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

apiAuditLogSchema.index({ apiKeyId: 1, timestamp: -1 });
apiAuditLogSchema.index({ endpoint: 1, responseStatus: 1, timestamp: -1 });

module.exports = mongoose.model('ApiAuditLog', apiAuditLogSchema);
