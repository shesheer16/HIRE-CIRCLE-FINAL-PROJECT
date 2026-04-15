const {
    buildEdgeContext,
    applyEdgeResponsePolicy,
} = require('../services/edgeCdnPolicyService');

const edgeCdnPolicyMiddleware = (req, res, next) => {
    const edgeContext = buildEdgeContext({
        user: req.user || null,
        requestedRegion: req.headers?.['x-region'] || req.headers?.['x-country'] || null,
    });

    req.edgeContext = edgeContext;
    applyEdgeResponsePolicy({ req, res, edgeContext });
    next();
};

module.exports = {
    edgeCdnPolicyMiddleware,
};
