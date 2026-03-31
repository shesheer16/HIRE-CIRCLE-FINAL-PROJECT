const PlatformAuditLog = require('../models/PlatformAuditLog');

const appendPlatformAuditLog = async ({
    eventType,
    actorType = 'system',
    actorId = null,
    apiKeyId = null,
    tenantId = null,
    route = null,
    method = null,
    resourceType = null,
    resourceId = null,
    action = null,
    status = null,
    metadata = {},
} = {}) => {
    if (!eventType) return null;

    try {
        return await PlatformAuditLog.create({
            eventType,
            actorType,
            actorId: actorId ? String(actorId) : null,
            apiKeyId,
            tenantId,
            route,
            method,
            resourceType,
            resourceId: resourceId ? String(resourceId) : null,
            action,
            status: Number.isFinite(status) ? Number(status) : null,
            metadata: metadata || {},
        });
    } catch (_error) {
        return null;
    }
};

const attachPlatformAuditOnResponse = (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        void appendPlatformAuditLog({
            eventType: 'platform.request.completed',
            actorType: req.externalApiKey ? 'api_key' : req.user?.isAdmin ? 'admin' : req.user ? 'user' : 'system',
            actorId: req.externalApiKey?._id || req.user?._id || null,
            apiKeyId: req.externalApiKey?._id || null,
            tenantId: req.tenantContext?.tenantId || req.user?.organizationId || null,
            route: req.originalUrl,
            method: req.method,
            action: 'request_complete',
            status: res.statusCode,
            metadata: {
                latencyMs: Number(latencyMs.toFixed(2)),
                correlationId: req.correlationId || null,
            },
        });
    });

    next();
};

module.exports = {
    appendPlatformAuditLog,
    attachPlatformAuditOnResponse,
};
