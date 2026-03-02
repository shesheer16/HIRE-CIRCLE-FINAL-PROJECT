const User = require('../models/userModel');

const resolveTenantContextFromApiKey = (apiKey = null) => {
    if (!apiKey) {
        return {
            tenantId: null,
            ownerId: null,
            mode: 'none',
        };
    }

    const tenantId = apiKey.organization || null;
    const ownerId = apiKey.ownerId || apiKey.employerId || null;

    return {
        tenantId,
        ownerId,
        mode: tenantId ? 'organization' : 'owner',
    };
};

const getTenantEmployerIds = async ({ tenantId, ownerId } = {}) => {
    if (tenantId) {
        const users = await User.find({ organizationId: tenantId }).select('_id').lean();
        return users.map((user) => user._id);
    }

    if (ownerId) {
        return [ownerId];
    }

    return [];
};

const assertTenantAccessToEmployer = async ({ tenantContext, employerId } = {}) => {
    const targetEmployerId = String(employerId || '').trim();
    if (!targetEmployerId) return false;

    if (tenantContext?.mode === 'owner') {
        return String(tenantContext.ownerId || '') === targetEmployerId;
    }

    if (tenantContext?.mode === 'organization') {
        const user = await User.findOne({
            _id: targetEmployerId,
            organizationId: tenantContext.tenantId,
        })
            .select('_id')
            .lean();

        return Boolean(user);
    }

    return false;
};

module.exports = {
    resolveTenantContextFromApiKey,
    getTenantEmployerIds,
    assertTenantAccessToEmployer,
};
