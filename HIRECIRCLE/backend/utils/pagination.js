const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const toPositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const resolvePagination = ({
    page,
    limit,
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = 100,
} = {}) => {
    const safePage = toPositiveInteger(page, DEFAULT_PAGE);
    const requestedLimit = toPositiveInteger(limit, defaultLimit);
    const safeLimit = Math.min(maxLimit, requestedLimit);
    const safeSkip = (safePage - 1) * safeLimit;

    return {
        page: safePage,
        limit: safeLimit,
        skip: safeSkip,
        maxLimit,
    };
};

module.exports = {
    resolvePagination,
};
