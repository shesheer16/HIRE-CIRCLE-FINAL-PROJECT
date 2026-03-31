const { appendPlatformAuditLog } = require('../services/platformAuditService');

const attachTenantContext = (req, _res, next) => {
    const user = req.user || null;
    req.tenantContext = {
        tenantId: user?.organizationId || null,
        ownerId: user?._id || null,
        mode: user?.organizationId ? 'organization' : 'owner',
    };
    next();
};

const requireTenantResourceAccess = ({ ownerField = 'ownerId', tenantField = 'tenantId' } = {}) => (req, res, next) => {
    const filter = req.tenantContext?.tenantId
        ? { [tenantField]: req.tenantContext.tenantId }
        : { [ownerField]: req.user?._id };

    req.tenantFilter = filter;
    next();
};

const auditTenantViolation = async ({ req, resourceType, resourceId }) => {
    await appendPlatformAuditLog({
        eventType: 'tenant.violation',
        actorType: req.user?.isAdmin ? 'admin' : req.user ? 'user' : 'system',
        actorId: req.user?._id || null,
        tenantId: req.tenantContext?.tenantId || null,
        route: req.originalUrl,
        method: req.method,
        resourceType,
        resourceId,
        action: 'tenant_access_denied',
        status: 403,
    });
};

module.exports = {
    attachTenantContext,
    requireTenantResourceAccess,
    auditTenantViolation,
};
