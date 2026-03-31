const normalizeLocationText = (value = '') => String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

export const buildLocationLabel = ({
    district = '',
    mandal = '',
    fallback = '',
} = {}) => {
    const safeDistrict = normalizeLocationText(district);
    const safeMandal = normalizeLocationText(mandal);
    const safeFallback = normalizeLocationText(fallback);
    return [safeMandal, safeDistrict].filter(Boolean).join(' • ') || safeFallback;
};

export const resolveStructuredLocation = (row = {}) => {
    const district = normalizeLocationText(row?.district || row?.city || row?.location || '');
    const mandal = normalizeLocationText(
        row?.mandal
        || row?.locality
        || row?.panchayat
        || ''
    );
    const locationLabel = buildLocationLabel({
        district,
        mandal,
        fallback: row?.locationLabel || row?.location || '',
    });

    return {
        district,
        mandal,
        locationLabel,
    };
};

export const buildLocationSearchBlob = (row = {}) => {
    const { district, mandal, locationLabel } = resolveStructuredLocation(row);
    return [
        district,
        mandal,
        locationLabel,
        normalizeLocationText(row?.location),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
};
