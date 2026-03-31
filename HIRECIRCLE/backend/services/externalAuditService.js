const ApiAuditLog = require('../models/ApiAuditLog');
const { readIpAddress } = require('./externalRateLimitService');

const startAuditTimer = (req, _res, next) => {
    req.externalAuditStartedAt = process.hrtime.bigint();
    next();
};

const persistAuditLogOnFinish = (req, res, next) => {
    res.on('finish', () => {
        try {
            const startedAt = req.externalAuditStartedAt;
            const elapsedMs = startedAt
                ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
                : 0;

            void ApiAuditLog.create({
                apiKeyId: req.externalApiKey?._id || null,
                endpoint: req.originalUrl,
                ip: readIpAddress(req),
                responseStatus: Number(res.statusCode || 0),
                latency: Number.isFinite(elapsedMs) ? Number(elapsedMs.toFixed(2)) : 0,
                timestamp: new Date(),
            });
        } catch (_error) {
            // best-effort audit logging
        }
    });

    next();
};

module.exports = {
    startAuditTimer,
    persistAuditLogOnFinish,
};
