const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const { AP_DISTRICTS, AP_LOCATIONS } = require('../match/apRegionalDataV19');
const {
    buildLocationLabel,
    normalizeLocationText,
    resolveStructuredLocationFields,
} = require('../utils/locationFields');

const normalizeLookupKey = (value = '') => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const DISTRICT_COMPAT_ALIASES = Object.freeze({
    alluri: 'Alluri Sitharama Raju',
    anantapur: 'Ananthapuramu',
    konaseema: 'Dr. B.R. Ambedkar Konaseema',
    'dr br ambedkar konaseema': 'Dr. B.R. Ambedkar Konaseema',
    'dr b r ambedkar konaseema': 'Dr. B.R. Ambedkar Konaseema',
    'east godavari': 'East Godavari',
    'west godavari': 'West Godavari',
    nellore: 'Sri Potti Sriramulu Nellore',
    'spsr nellore': 'Sri Potti Sriramulu Nellore',
    'sri potti sriramulu nellore': 'Sri Potti Sriramulu Nellore',
    kadapa: 'Y.S.R. Kadapa',
    'ysr kadapa': 'Y.S.R. Kadapa',
    'y s r kadapa': 'Y.S.R. Kadapa',
    'visakhapatnam urban': 'Visakhapatnam',
    vijayawada: 'NTR',
    rajahmundry: 'East Godavari',
    ananthapuramu: 'Ananthapuramu',
});

const DISTRICT_ALIAS_MAP = new Map();
const LOCATION_ALIAS_MAP = new Map();

const registerAlias = (map, key, value) => {
    if (!key) return;
    const existing = map.get(key) || [];
    if (!existing.some((item) => item.district === value.district && item.mandal === value.mandal)) {
        existing.push(value);
        map.set(key, existing);
    }
};

AP_DISTRICTS.forEach((entry) => {
    const canonicalDistrict = String(entry?.canonicalDistrict || entry?.name || '').trim();
    const districtName = String(entry?.name || '').trim();
    const targets = [districtName, canonicalDistrict].filter(Boolean);
    targets.forEach((token) => {
        DISTRICT_ALIAS_MAP.set(normalizeLookupKey(token), canonicalDistrict);
    });
});

Object.entries(DISTRICT_COMPAT_ALIASES).forEach(([alias, canonical]) => {
    DISTRICT_ALIAS_MAP.set(normalizeLookupKey(alias), canonical);
});

AP_LOCATIONS.forEach((entry) => {
    const district = String(entry?.district || entry?.canonicalDistrict || '').trim();
    const mandal = String(entry?.mandal || entry?.name || '').trim();
    const locationPayload = {
        district,
        mandal,
        panchayat: String(entry?.panchayat || '').trim(),
    };
    [
        entry?.name,
        entry?.mandal,
        entry?.panchayat,
        ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
    ]
        .map((token) => normalizeLookupKey(token))
        .filter(Boolean)
        .forEach((aliasKey) => registerAlias(LOCATION_ALIAS_MAP, aliasKey, locationPayload));
});

const extractCandidateTokens = (row = {}) => {
    const values = [
        row?.district,
        row?.mandal,
        row?.city,
        row?.panchayat,
        row?.location,
        row?.locationLabel,
    ]
        .map((value) => normalizeLocationText(value, 160))
        .filter(Boolean);

    const tokenSet = new Set();
    values.forEach((value) => {
        const normalizedWhole = normalizeLookupKey(value);
        if (normalizedWhole) tokenSet.add(normalizedWhole);
        value
            .split(/[;,|/·]/g)
            .map((part) => normalizeLookupKey(part))
            .filter(Boolean)
            .forEach((part) => tokenSet.add(part));
    });

    return Array.from(tokenSet);
};

const resolveDistrictHint = (tokens = []) => {
    for (const token of tokens) {
        const exact = DISTRICT_ALIAS_MAP.get(token);
        if (exact) return exact;
    }

    for (const token of tokens) {
        if (token.length < 4) continue;
        for (const [alias, canonical] of DISTRICT_ALIAS_MAP.entries()) {
            if (token.includes(alias) || alias.includes(token)) {
                return canonical;
            }
        }
    }

    return '';
};

const resolveMandalHint = (tokens = [], districtHint = '') => {
    const pickCandidate = (rows = []) => {
        if (!rows.length) return null;
        if (districtHint) {
            const exactDistrict = rows.find((row) => normalizeLookupKey(row.district) === normalizeLookupKey(districtHint));
            if (exactDistrict) return exactDistrict;
        }
        return rows[0];
    };

    for (const token of tokens) {
        const exact = pickCandidate(LOCATION_ALIAS_MAP.get(token) || []);
        if (exact) return exact;
    }

    for (const token of tokens) {
        if (token.length < 4) continue;
        for (const [alias, rows] of LOCATION_ALIAS_MAP.entries()) {
            if (token.includes(alias) || alias.includes(token)) {
                const candidate = pickCandidate(rows);
                if (candidate) return candidate;
            }
        }
    }

    return null;
};

const inferStructuredLocationFromLegacy = (row = {}) => {
    const base = resolveStructuredLocationFields({
        district: row?.district,
        mandal: row?.mandal,
        locality: row?.locality,
        city: row?.city,
        panchayat: row?.panchayat,
        location: row?.location,
        locationLabel: row?.locationLabel,
    });

    const tokens = extractCandidateTokens(row);
    const districtHint = resolveDistrictHint(tokens) || base.district;
    const mandalHint = resolveMandalHint(tokens, districtHint);

    const district = districtHint || mandalHint?.district || base.district;
    const mandal = mandalHint?.mandal || base.mandal;
    const locationLabel = buildLocationLabel({
        district,
        mandal,
        fallback: base.locationLabel || row?.location || row?.city,
    }, 160);

    return {
        district: normalizeLocationText(district, 120),
        mandal: normalizeLocationText(mandal, 120),
        locationLabel: normalizeLocationText(locationLabel, 160),
    };
};

const buildPatch = (doc = {}, type = 'worker') => {
    const inferred = inferStructuredLocationFromLegacy(doc);
    const nextDistrict = inferred.district || normalizeLocationText(doc?.district || doc?.city, 120);
    const nextMandal = inferred.mandal || normalizeLocationText(doc?.mandal || doc?.panchayat, 120);
    const nextLocationLabel = inferred.locationLabel || buildLocationLabel({
        district: nextDistrict,
        mandal: nextMandal,
        fallback: doc?.locationLabel || doc?.location || doc?.city,
    }, 160);

    const patch = {
        district: nextDistrict || null,
        mandal: nextMandal || null,
        locationLabel: nextLocationLabel || null,
    };

    if (type === 'worker') {
        patch.city = normalizeLocationText(doc?.city || nextDistrict || nextLocationLabel, 120) || null;
        patch.panchayat = normalizeLocationText(doc?.panchayat || nextMandal, 120) || null;
    } else {
        patch.location = normalizeLocationText(doc?.location || nextLocationLabel || nextDistrict, 160) || null;
    }

    return patch;
};

const hasPatchDiff = (doc = {}, patch = {}) => (
    String(doc?.district || '') !== String(patch?.district || '')
    || String(doc?.mandal || '') !== String(patch?.mandal || '')
    || String(doc?.locationLabel || '') !== String(patch?.locationLabel || '')
    || ('city' in patch && String(doc?.city || '') !== String(patch?.city || ''))
    || ('panchayat' in patch && String(doc?.panchayat || '') !== String(patch?.panchayat || ''))
    || ('location' in patch && String(doc?.location || '') !== String(patch?.location || ''))
);

const buildCandidateQuery = () => ({
    $or: [
        { district: null },
        { district: '' },
        { mandal: null },
        { mandal: '' },
        { locationLabel: null },
        { locationLabel: '' },
    ],
});

const runCollectionBackfill = async ({ Model, type, select }) => {
    const docs = await Model.find(buildCandidateQuery()).select(select).lean();
    if (!docs.length) {
        return { scanned: 0, updated: 0 };
    }

    const ops = docs
        .map((doc) => {
            const patch = buildPatch(doc, type);
            if (!hasPatchDiff(doc, patch)) return null;
            return {
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: patch },
                },
            };
        })
        .filter(Boolean);

    if (!ops.length) {
        return { scanned: docs.length, updated: 0 };
    }

    const result = await Model.bulkWrite(ops, { ordered: false });
    return {
        scanned: docs.length,
        updated: Number(result.modifiedCount || 0),
    };
};

const backfillStructuredLocations = async () => {
    const [workers, employers, jobs] = await Promise.all([
        runCollectionBackfill({
            Model: WorkerProfile,
            type: 'worker',
            select: '_id city district mandal panchayat locationLabel',
        }),
        runCollectionBackfill({
            Model: EmployerProfile,
            type: 'employer',
            select: '_id location district mandal locationLabel',
        }),
        runCollectionBackfill({
            Model: Job,
            type: 'job',
            select: '_id location district mandal locationLabel',
        }),
    ]);

    return {
        workers,
        employers,
        jobs,
        updated: workers.updated + employers.updated + jobs.updated,
    };
};

module.exports = {
    backfillStructuredLocations,
    buildPatch,
    inferStructuredLocationFromLegacy,
};
