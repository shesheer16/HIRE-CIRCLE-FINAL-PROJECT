'use strict';
/**
 * apMatchEngineV16.js
 *
 * AP-first regional overlay:
 * - Uses job geo coordinates (when present) + AP location table to estimate worker/job distance.
 * - Adds small, capped boosts for rural proximity and Madanapalle-first rollout.
 *
 * The goal is "better defaults" without breaking generic matching:
 * if we can't resolve locations, we return null and the caller falls back.
 */

const {
    ZONE,
    AP_LOCATIONS,
    AP_HAVERSINE,
    AP_ZONE_META,
} = require('./apRegionalDataV10');

const AP_ENGINE_VERSION = '16.0-AP-REGIONAL-LAUNCH';

// Tunables (kept conservative; we cap the final multiplier regardless).
const AP_RURAL_BOOST = 0.25;
const AP_VILLAGE_PROXIMITY_BOOST = 0.30;
const AP_LANGUAGE_PENALTY = 0.42;
const AP_TRAINABILITY_BONUS = 0.24;
const AP_SPARSE_FALLBACK = 0.84;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const clamp = (value, min, max) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeKey = (value) => normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isFiniteLatLng = (lat, lng) => (
    Number.isFinite(Number(lat))
    && Number.isFinite(Number(lng))
    && Math.abs(Number(lat)) <= 90
    && Math.abs(Number(lng)) <= 180
    && !(Number(lat) === 0 && Number(lng) === 0)
);

const haversineKm = (left, right) => {
    const lat1 = Number(left?.lat);
    const lon1 = Number(left?.lng);
    const lat2 = Number(right?.lat);
    const lon2 = Number(right?.lng);
    if (!isFiniteLatLng(lat1, lon1) || !isFiniteLatLng(lat2, lon2)) return null;

    const R = 6371; // km
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const buildLocationIndex = () => {
    const index = new Map();
    for (const row of AP_LOCATIONS) {
        const keys = [
            row?.n,
            row?.district,
            row?.mandal,
        ]
            .filter(Boolean)
            .map((value) => normalizeKey(value))
            .filter(Boolean);

        for (const key of keys) {
            if (!index.has(key)) index.set(key, row);
        }
    }
    return index;
};

const AP_LOCATION_INDEX = buildLocationIndex();

const resolveApLocation = (rawValue) => {
    const query = normalizeKey(rawValue);
    if (!query) return null;

    const exact = AP_LOCATION_INDEX.get(query);
    if (exact) return exact;

    // Best-effort substring match with a small floor to avoid noisy matches.
    let best = null;
    let bestScore = 0;

    for (const [key, row] of AP_LOCATION_INDEX.entries()) {
        if (!key) continue;
        if (query === key) return row;
        const hit = query.includes(key) || key.includes(query);
        if (!hit) continue;
        const score = Math.min(query.length, key.length);
        if (score > bestScore) {
            bestScore = score;
            best = row;
        }
    }

    return bestScore >= 6 ? best : null;
};

const extractGeoPoint = (entity = {}) => {
    const coords = entity?.geo?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (isFiniteLatLng(lat, lng)) return { lat, lng, source: 'geo' };
    }

    const lat = Number(entity?.lat ?? entity?.latitude);
    const lng = Number(entity?.lng ?? entity?.longitude);
    if (isFiniteLatLng(lat, lng)) return { lat, lng, source: 'latlng' };

    return null;
};

const resolvePointFromLocationText = (value) => {
    const location = resolveApLocation(value);
    if (!location) return null;
    if (!isFiniteLatLng(location.lat, location.lng)) return null;
    return {
        lat: location.lat,
        lng: location.lng,
        source: 'ap_locations',
        location,
    };
};

const resolveApPoints = ({ job = {}, worker = {} }) => {
    const jobGeo = extractGeoPoint(job);
    const jobFromText = resolvePointFromLocationText(job?.location);
    const workerGeo = extractGeoPoint(worker);
    const workerFromText = resolvePointFromLocationText(worker?.city || worker?.location);

    const jobPoint = jobGeo || jobFromText;
    const workerPoint = workerGeo || workerFromText;

    return {
        jobPoint,
        workerPoint,
        jobLocationMeta: jobFromText?.location || jobPoint?.location || null,
        workerLocationMeta: workerFromText?.location || workerPoint?.location || null,
    };
};

const isApRelevant = ({ job = {}, worker = {} }) => {
    const regionCode = normalizeKey(job?.regionCode || job?.region || '');
    if (regionCode.startsWith('in ap') || regionCode.startsWith('in-ap')) return true;
    return Boolean(resolveApLocation(job?.location) || resolveApLocation(worker?.city || worker?.location));
};

const deriveMaxCommuteKm = ({ worker = {}, scoringContext = {} }) => {
    const contextOverride = Number(scoringContext?.maxCommuteDistanceKm);
    if (Number.isFinite(contextOverride) && contextOverride > 0) return contextOverride;

    const preference = Number(worker?.settings?.matchPreferences?.maxCommuteDistanceKm);
    if (Number.isFinite(preference) && preference > 0) return preference;

    return 25;
};

const scoreDistanceKm = (distanceKm) => {
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km < 0) return null;
    if (km <= 5) return 1;
    if (km <= AP_HAVERSINE.MANDAL_KM) return 0.98;
    if (km <= 15) return 0.95;
    if (km <= AP_HAVERSINE.METRO_KM) return 0.9;
    if (km <= AP_HAVERSINE.DISTRICT_KM) return 0.75;
    if (km <= AP_HAVERSINE.REGIONAL_KM) return 0.55;
    return 0.35;
};

const getApDistanceScore = ({ job = {}, worker = {}, scoringContext = {} }) => {
    if (!isApRelevant({ job, worker })) return null;

    const { jobPoint, workerPoint } = resolveApPoints({ job, worker });
    if (!jobPoint || !workerPoint) return null;

    const distanceKm = haversineKm(jobPoint, workerPoint);
    if (!Number.isFinite(Number(distanceKm))) return null;

    const maxCommuteDistanceKm = deriveMaxCommuteKm({ worker, scoringContext });
    const toleranceEnabled = scoringContext?.distanceToleranceEnabled !== false;
    const fallbackScoreDefault = maxCommuteDistanceKm >= 40 ? AP_SPARSE_FALLBACK : 0.58;
    const fallbackScore = clamp01(scoringContext?.distanceFallbackScore ?? fallbackScoreDefault);

    if (distanceKm > maxCommuteDistanceKm) {
        if (toleranceEnabled) {
            return {
                distanceScore: fallbackScore,
                outsideRadius: false,
                toleranceApplied: true,
                distanceKm,
                distanceSource: jobPoint.source === 'geo' ? 'job_geo' : 'ap_locations',
            };
        }

        return {
            distanceScore: clamp01(scoreDistanceKm(distanceKm) ?? 0.4),
            outsideRadius: true,
            toleranceApplied: false,
            distanceKm,
            distanceSource: jobPoint.source === 'geo' ? 'job_geo' : 'ap_locations',
        };
    }

    return {
        distanceScore: clamp01(scoreDistanceKm(distanceKm) ?? 0.8),
        outsideRadius: false,
        toleranceApplied: false,
        distanceKm,
        distanceSource: jobPoint.source === 'geo' ? 'job_geo' : 'ap_locations',
    };
};

const languageLooksTelugu = (languageValue) => {
    const normalized = normalizeKey(languageValue);
    if (!normalized) return null;
    if (normalized.includes('telugu')) return true;
    if (normalized === 'te' || normalized.includes(' te ')) return true;
    return false;
};

const getApRegionalAdjustment = ({
    job = {},
    worker = {},
    workerUser = null,
    roleData = {},
    scoringContext = {},
    distanceKm = null,
    requiredExp = 0,
}) => {
    if (!isApRelevant({ job, worker })) return null;

    const jobLocationMeta = resolveApLocation(job?.location);
    const workerLocationMeta = resolveApLocation(worker?.city || worker?.location);
    if (!jobLocationMeta && !workerLocationMeta) return null;

    const jobZone = jobLocationMeta?.zone || null;
    const workerZone = workerLocationMeta?.zone || null;
    const ruralMeta = AP_ZONE_META?.rural || {};

    let multiplier = 1;
    const reasons = [];

    const isRuralContext = (
        jobZone === ZONE.RURAL
        || workerZone === ZONE.RURAL
        || jobZone === ZONE.AGRICULTURAL
        || workerZone === ZONE.AGRICULTURAL
    );
    if (isRuralContext) {
        multiplier *= 1 + clamp(Number(AP_RURAL_BOOST ?? ruralMeta.ruralBoost ?? 0), 0, 0.35);
        reasons.push('AP_RURAL_BOOST');
    }

    const normalizedJobPanchayat = normalizeKey(job?.panchayat);
    const normalizedWorkerPanchayat = normalizeKey(worker?.panchayat);
    const panchayatMatch = normalizedJobPanchayat && normalizedWorkerPanchayat && normalizedJobPanchayat === normalizedWorkerPanchayat;
    if (panchayatMatch) {
        multiplier *= 1 + clamp(AP_VILLAGE_PROXIMITY_BOOST, 0, 0.35);
        reasons.push('AP_PANCHAYAT_MATCH');
    } else if (Number.isFinite(Number(distanceKm)) && Number(distanceKm) <= 5) {
        multiplier *= 1 + clamp(AP_VILLAGE_PROXIMITY_BOOST, 0, 0.35);
        reasons.push('AP_VILLAGE_PROXIMITY');
    }

    const roleExp = Number(roleData?.experienceInRole ?? 0);
    const required = Number(requiredExp ?? 0);
    if (required > 0 && roleExp >= 0 && roleExp < required * 0.6) {
        multiplier *= 1 + clamp(AP_TRAINABILITY_BONUS, 0, 0.3);
        reasons.push('AP_TRAINABILITY_BONUS');
    }

    // Language is treated as a soft factor; only penalize when explicitly known.
    const candidateLanguage = worker?.language || workerUser?.language || '';
    const isTelugu = languageLooksTelugu(candidateLanguage);
    if (isTelugu === true) {
        multiplier *= 1.02;
        reasons.push('AP_TELUGU_LANGUAGE');
    } else if (isTelugu === false && isRuralContext) {
        const penalty = clamp(1 - (AP_LANGUAGE_PENALTY * 0.25), 0.85, 1);
        multiplier *= penalty;
        reasons.push('AP_LANGUAGE_PENALTY');
    }

    const cappedMultiplier = clamp(multiplier, 0.85, 1.15);

    return {
        apEngineVersion: AP_ENGINE_VERSION,
        multiplier: cappedMultiplier,
        uncappedMultiplier: multiplier,
        reasons,
        job: {
            zone: jobZone,
            district: jobLocationMeta?.district || null,
            mandal: jobLocationMeta?.mandal || null,
            name: jobLocationMeta?.n || null,
        },
        worker: {
            zone: workerZone,
            district: workerLocationMeta?.district || null,
            mandal: workerLocationMeta?.mandal || null,
            name: workerLocationMeta?.n || null,
        },
        distanceKm: Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : null,
    };
};

module.exports = {
    AP_ENGINE_VERSION,
    resolveApLocation,
    getApDistanceScore,
    getApRegionalAdjustment,
};

