const normalizeLocationText = (value, maxLength = 120) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

const buildLocationLabel = ({
    district = '',
    mandal = '',
    fallback = '',
} = {}, maxLength = 120) => {
    const safeDistrict = normalizeLocationText(district, maxLength);
    const safeMandal = normalizeLocationText(mandal, maxLength);
    const safeFallback = normalizeLocationText(fallback, maxLength);
    const joined = [safeMandal, safeDistrict].filter(Boolean).join(', ');
    return joined || safeFallback;
};

const resolveStructuredLocationFields = ({
    district,
    mandal,
    locality,
    city,
    panchayat,
    location,
    locationLabel,
} = {}, maxLength = 120) => {
    const safeDistrict = normalizeLocationText(
        district || city || '',
        maxLength
    );
    const safeMandal = normalizeLocationText(
        mandal || locality || panchayat || '',
        maxLength
    );
    const safeFallback = normalizeLocationText(
        locationLabel || location || city || '',
        maxLength
    );
    const safeLocationLabel = buildLocationLabel({
        district: safeDistrict,
        mandal: safeMandal,
        fallback: safeFallback,
    }, maxLength);

    return {
        district: safeDistrict,
        mandal: safeMandal,
        locationLabel: safeLocationLabel,
        legacyCity: safeDistrict || safeLocationLabel,
        legacyPanchayat: safeMandal,
        legacyLocation: safeLocationLabel || safeDistrict,
    };
};

const getNormalizedLocationParts = (row = {}) => ({
    district: normalizeLocationText(row?.district || row?.city || row?.location || '', 120).toLowerCase(),
    mandal: normalizeLocationText(row?.mandal || row?.locality || row?.panchayat || '', 120).toLowerCase(),
    locationLabel: normalizeLocationText(
        row?.locationLabel
        || row?.location
        || buildLocationLabel({
            district: row?.district || row?.city || '',
            mandal: row?.mandal || row?.locality || row?.panchayat || '',
        }, 120),
        120
    ).toLowerCase(),
});

module.exports = {
    buildLocationLabel,
    getNormalizedLocationParts,
    normalizeLocationText,
    resolveStructuredLocationFields,
};
