const { normalizeCountryCode } = require('./geoExpansionService');

const normalizeBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
};

const normalizeCountry = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return normalizeCountryCode(raw);
};

const isCrossBorderAllowed = ({ user = null, queryValue = null }) => {
    const queryOverride = normalizeBoolean(queryValue, null);
    if (queryOverride !== null) return queryOverride;
    return Boolean(user?.globalPreferences?.crossBorderMatchEnabled);
};

const filterJobsByGeo = ({ jobs = [], user = null, allowCrossBorder = false }) => {
    const userCountry = normalizeCountry(user?.country);

    const filtered = (Array.isArray(jobs) ? jobs : []).filter((job) => {
        if (job?.remoteAllowed) return true;
        if (allowCrossBorder) return true;

        const jobCountry = normalizeCountry(job?.country || job?.countryCode);
        if (!jobCountry || !userCountry) return true;
        return jobCountry === userCountry;
    });

    return {
        jobs: filtered,
        filteredCount: Math.max(0, (Array.isArray(jobs) ? jobs.length : 0) - filtered.length),
    };
};

const filterWorkersByGeo = ({ workers = [], job = null, allowCrossBorder = false }) => {
    const jobCountry = normalizeCountry(job?.country || job?.countryCode);
    const filtered = (Array.isArray(workers) ? workers : []).filter((row) => {
        if (job?.remoteAllowed) return true;
        if (allowCrossBorder) return true;

        const workerCountry = normalizeCountry(row?.user?.country);
        if (!workerCountry || !jobCountry) return true;
        return workerCountry === jobCountry;
    });

    return {
        workers: filtered,
        filteredCount: Math.max(0, (Array.isArray(workers) ? workers.length : 0) - filtered.length),
    };
};

module.exports = {
    isCrossBorderAllowed,
    filterJobsByGeo,
    filterWorkersByGeo,
};
