'use strict';
/**
 * apMatchEngineV19.js
 *
 * Safe AP-first regional overlay aligned with the V19 geography dataset.
 * It keeps the current matcher stable while enriching scoring with:
 * - Madanapalle-first panchayat proximity
 * - LGD-aware locality hierarchy
 * - smartphone / gig friendliness
 * - seasonal and voice/dialect soft adjustments
 *
 * All AP-specific multipliers remain conservatively capped before they reach
 * the core match engine.
 */

const { evaluateCompositeMatch } = require('./apexSynthesisMatcher');
const {
    ZONE,
    AP_DISTRICTS,
    AP_LOCATIONS,
    AP_JOB_CATEGORIES,
    AP_ADJACENCY_GRAPH,
    AP_HAVERSINE,
    VBG_RAM_G_CONFIG,
    DIALECT_AFFINITY,
} = require('./apRegionalDataV19');

const AP_ENGINE_VERSION = '19.0-AP-FINAL-LGD-2026-LOCKED';

const AP_RURAL_BOOST = 0.27;
const AP_SMARTPHONE_GIG_BOOST = 1.42;
const AP_LANGUAGE_PENALTY = 0.38;
const AP_SPARSE_FALLBACK = 0.82;
const AP_VILLAGE_PROXIMITY_BOOST = 0.34;
const AP_SEASONAL_HARVEST_BOOST = 1.42;
const AP_MGNREGA_DECAY = 0.68;
const AP_GENDER_MOBILITY_PENALTY = 0.84;
const AP_TRAINABILITY_BONUS = 0.28;
const AP_PANCHAYAT_REPUTATION_BOOST = 0.24;
const AP_MANDAL_LGD_BOOST = 0.08;
const AP_DISTRICT_LGD_BOOST = 0.03;

const TIERS = Object.freeze({
    STRONG: 0.82,
    GOOD: 0.70,
    POSSIBLE: 0.62,
});

const DISTRICT_ALIAS_MAP = new Map([
    ['nellore', 'Sri Potti Sriramulu Nellore'],
    ['spsr nellore', 'Sri Potti Sriramulu Nellore'],
    ['konaseema', 'Dr. B.R. Ambedkar Konaseema'],
    ['kadapa', 'Y.S.R. Kadapa'],
    ['ysr kadapa', 'Y.S.R. Kadapa'],
    ['ysr', 'Y.S.R. Kadapa'],
    ['madanapalli', 'Madanapalle'],
]);

const DIGITAL_GIG_KEYWORDS = new Set([
    ...(AP_JOB_CATEGORIES.DIGITAL_GIG || []),
    'gig',
    'delivery',
    'field sales',
    'telecalling',
    'app support',
    'catalog',
    'micro task',
    'reels',
    'video',
]);

const AGRICULTURE_KEYWORDS = new Set([
    ...(AP_JOB_CATEGORIES.AGRICULTURE || []),
    'agri',
    'agriculture',
    'farm',
    'harvest',
    'tractor',
]);

const INFRA_KEYWORDS = new Set([
    ...(AP_JOB_CATEGORIES.INFRA || []),
    'vbg',
    'vb g',
    'ram g',
    'infra',
    'rural work',
    'works',
]);

const VOICE_KEYWORDS = new Set([
    ...(AP_JOB_CATEGORIES.VOICE || []),
    'voice',
    'telecalling',
    'customer support',
    'sales calling',
]);

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const clamp = (value, min, max) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeKey = (value) => normalizeText(value)
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
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

    const radiusKm = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return radiusKm * c;
};

const DISTRICT_NAME_SET = new Set(AP_DISTRICTS.map((row) => normalizeKey(row.name)));

const appendIndexedValue = (map, key, row) => {
    if (!key || !row) return;
    const existing = map.get(key);
    if (!existing) {
        map.set(key, [row]);
        return;
    }
    if (!existing.includes(row)) {
        existing.push(row);
    }
};

const dedupeRows = (rows = []) => {
    const seen = new Set();
    const output = [];
    rows.forEach((row) => {
        if (!row || seen.has(row)) return;
        seen.add(row);
        output.push(row);
    });
    return output;
};

const getCandidateNameKeys = (row = {}) => [
    row?.name,
    row?.n,
    row?.district,
    row?.mandal,
    row?.panchayat,
    ...(Array.isArray(row?.aliases) ? row.aliases : []),
]
    .filter(Boolean)
    .map((value) => DISTRICT_ALIAS_MAP.get(normalizeKey(value)) || normalizeKey(value))
    .filter(Boolean);

const buildLocationIndex = () => {
    const keyIndex = new Map();
    const codeIndex = new Map();

    for (const row of AP_LOCATIONS) {
        const keys = getCandidateNameKeys(row);

        for (const key of keys) {
            appendIndexedValue(keyIndex, key, row);
        }

        const numericCode = Number(row?.lgdCode);
        if (Number.isFinite(numericCode) && numericCode > 0) {
            appendIndexedValue(codeIndex, numericCode, row);
        }
    }

    for (const district of AP_DISTRICTS) {
        const districtKey = normalizeKey(district?.name);
        if (districtKey && !keyIndex.has(districtKey)) {
            const synthetic = {
                name: district.name,
                n: district.name,
                district: district.name,
                mandal: district.name,
                lgdCode: district.lgdCode,
                zone: ZONE.URBAN,
                lat: null,
                lng: null,
                isDistrictOnly: true,
            };
            appendIndexedValue(keyIndex, districtKey, synthetic);
            const numericCode = Number(district?.lgdCode);
            if (Number.isFinite(numericCode) && numericCode > 0) {
                appendIndexedValue(codeIndex, numericCode, synthetic);
            }
        }
    }

    return {
        keyIndex,
        codeIndex,
    };
};

const AP_LOCATION_INDEX = buildLocationIndex();

const extractPoint = (entity = {}) => {
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

const extractLocationHints = (entity = {}) => {
    const districtHint = DISTRICT_ALIAS_MAP.get(normalizeKey(entity?.district)) || normalizeKey(entity?.district);
    return [
        entity?.location,
        entity?.city,
        entity?.district,
        districtHint,
        entity?.mandal,
        entity?.panchayat,
        entity?.address?.addressLocality,
        entity?.address?.addressRegion,
    ]
        .filter(Boolean)
        .map((value) => DISTRICT_ALIAS_MAP.get(normalizeKey(value)) || normalizeKey(value))
        .filter(Boolean);
};

const scoreLocationCandidate = (row = {}, entity = {}, query = '') => {
    const normalizedQuery = DISTRICT_ALIAS_MAP.get(normalizeKey(query)) || normalizeKey(query);
    const rowKeys = getCandidateNameKeys(row);
    const hintSet = new Set(extractLocationHints(entity));
    const districtHint = DISTRICT_ALIAS_MAP.get(normalizeKey(entity?.district)) || normalizeKey(entity?.district);
    const mandalHint = DISTRICT_ALIAS_MAP.get(normalizeKey(entity?.mandal)) || normalizeKey(entity?.mandal);
    const panchayatHint = DISTRICT_ALIAS_MAP.get(normalizeKey(entity?.panchayat)) || normalizeKey(entity?.panchayat);

    let score = 0;

    if (normalizedQuery && rowKeys.includes(normalizedQuery)) score += 20;
    if (districtHint && normalizeKey(row?.district) === districtHint) score += 18;
    if (mandalHint && normalizeKey(row?.mandal) === mandalHint) score += 16;
    if (panchayatHint && normalizeKey(row?.panchayat) === panchayatHint) score += 22;

    if (hintSet.size > 0) {
        rowKeys.forEach((key) => {
            if (hintSet.has(key)) score += 8;
        });
    }

    const entityLgdCodes = [
        Number(entity?.mandalLgd),
        Number(entity?.districtLgd),
        Number(entity?.lgdCode),
    ].filter((value) => Number.isFinite(value) && value > 0);
    const rowLgdCode = Number(row?.lgdCode);
    if (entityLgdCodes.some((code) => code === rowLgdCode)) {
        score += 12;
    }

    if (normalizedQuery && rowKeys.some((key) => key.includes(normalizedQuery) || normalizedQuery.includes(key))) {
        score += 4;
    }

    if (row?.isDistrictOnly) score -= 6;

    return score;
};

const resolveApLocation = (value) => {
    const query = DISTRICT_ALIAS_MAP.get(normalizeKey(value)) || normalizeKey(value);
    if (!query) return null;

    const exact = AP_LOCATION_INDEX.keyIndex.get(query);
    if (Array.isArray(exact) && exact.length > 0) return exact[0];

    let best = null;
    let bestScore = 0;
    for (const [key, rows] of AP_LOCATION_INDEX.keyIndex.entries()) {
        if (!key) continue;
        if (!(query.includes(key) || key.includes(query))) continue;
        const score = Math.min(query.length, key.length);
        if (score > bestScore) {
            bestScore = score;
            best = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        }
    }

    return bestScore >= 6 ? best : null;
};

const resolveApLocationFromEntity = (entity = {}) => {
    const candidates = [];
    const numericCodes = [
        Number(entity?.mandalLgd),
        Number(entity?.districtLgd),
        Number(entity?.lgdCode),
    ].filter((value) => Number.isFinite(value) && value > 0);

    for (const code of numericCodes) {
        const byCode = AP_LOCATION_INDEX.codeIndex.get(code);
        if (Array.isArray(byCode)) {
            candidates.push(...byCode);
        }
    }

    const hints = extractLocationHints(entity);
    for (const hint of hints) {
        const byHint = resolveApLocation(hint);
        if (byHint) candidates.push(byHint);
        const exactMatches = AP_LOCATION_INDEX.keyIndex.get(hint);
        if (Array.isArray(exactMatches)) {
            candidates.push(...exactMatches);
        }
    }

    const uniqueCandidates = dedupeRows(candidates);
    if (!uniqueCandidates.length) return null;
    if (uniqueCandidates.length === 1) return uniqueCandidates[0];

    return uniqueCandidates
        .map((row) => ({
            row,
            score: scoreLocationCandidate(row, entity, entity?.location || entity?.city || entity?.mandal || entity?.panchayat || entity?.district || ''),
        }))
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.row)[0] || null;
};

const resolveApPoints = ({ job = {}, worker = {} }) => {
    const jobGeo = extractPoint(job);
    const workerGeo = extractPoint(worker);
    const jobMeta = resolveApLocationFromEntity(job);
    const workerMeta = resolveApLocationFromEntity(worker);

    const jobPoint = jobGeo || (isFiniteLatLng(jobMeta?.lat, jobMeta?.lng)
        ? { lat: jobMeta.lat, lng: jobMeta.lng, source: 'ap_locations', location: jobMeta }
        : null);
    const workerPoint = workerGeo || (isFiniteLatLng(workerMeta?.lat, workerMeta?.lng)
        ? { lat: workerMeta.lat, lng: workerMeta.lng, source: 'ap_locations', location: workerMeta }
        : null);

    return {
        jobPoint,
        workerPoint,
        jobLocationMeta: jobMeta || jobPoint?.location || null,
        workerLocationMeta: workerMeta || workerPoint?.location || null,
    };
};

const isApRelevant = ({ job = {}, worker = {} }) => {
    const regionCandidates = [
        job?.regionCode,
        job?.region,
        worker?.regionCode,
        worker?.region,
        job?.state,
        worker?.state,
    ]
        .map((value) => normalizeKey(value))
        .filter(Boolean);

    if (regionCandidates.some((value) => value.includes('andhra pradesh') || value === 'ap' || value === 'in ap' || value === 'in-ap')) {
        return true;
    }

    if (resolveApLocationFromEntity(job) || resolveApLocationFromEntity(worker)) {
        return true;
    }

    const districtHints = [
        normalizeKey(job?.district),
        normalizeKey(worker?.district),
    ].filter(Boolean);

    if (districtHints.some((value) => DISTRICT_NAME_SET.has(value) || DISTRICT_ALIAS_MAP.has(value))) {
        return true;
    }

    const lgdCodes = [
        Number(job?.mandalLgd),
        Number(job?.districtLgd),
        Number(worker?.mandalLgd),
        Number(worker?.districtLgd),
    ].filter((value) => Number.isFinite(value) && value > 0);

    return lgdCodes.some((code) => AP_LOCATION_INDEX.codeIndex.has(code));
};

const deriveMaxCommuteKm = ({ worker = {}, scoringContext = {} }) => {
    const contextValue = Number(scoringContext?.maxCommuteDistanceKm);
    if (Number.isFinite(contextValue) && contextValue > 0) return contextValue;

    const workerPreference = Number(
        worker?.settings?.matchPreferences?.maxCommuteDistanceKm
        ?? worker?.matchPreferences?.maxCommuteDistanceKm
    );
    if (Number.isFinite(workerPreference) && workerPreference > 0) return workerPreference;

    return 25;
};

const scoreDistanceKm = (distanceKm) => {
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km < 0) return null;
    if (km <= AP_HAVERSINE.PANCHAYAT_KM) return 1;
    if (km <= 5) return 0.99;
    if (km <= AP_HAVERSINE.MANDAL_KM) return 0.96;
    if (km <= 30) return 0.9;
    if (km <= AP_HAVERSINE.DISTRICT_KM) return 0.76;
    if (km <= AP_HAVERSINE.REGIONAL_KM) return 0.55;
    return 0.36;
};

const getLgdHierarchyMeta = ({ job = {}, worker = {}, jobLocationMeta = null, workerLocationMeta = null }) => {
    const sameMandal = (
        Number(job?.mandalLgd) > 0
        && Number(worker?.mandalLgd) > 0
        && Number(job.mandalLgd) === Number(worker.mandalLgd)
    );
    if (sameMandal) {
        return {
            sameMandal: true,
            sameDistrict: true,
            multiplier: 1 + AP_MANDAL_LGD_BOOST,
            reason: 'AP_LGD_MANDAL_MATCH',
        };
    }

    const sameDistrictByCode = (
        Number(job?.districtLgd) > 0
        && Number(worker?.districtLgd) > 0
        && Number(job.districtLgd) === Number(worker.districtLgd)
    );
    const sameDistrictByText = (
        normalizeKey(jobLocationMeta?.district)
        && normalizeKey(jobLocationMeta?.district) === normalizeKey(workerLocationMeta?.district)
    );

    if (sameDistrictByCode || sameDistrictByText) {
        return {
            sameMandal: false,
            sameDistrict: true,
            multiplier: 1 + AP_DISTRICT_LGD_BOOST,
            reason: 'AP_LGD_DISTRICT_MATCH',
        };
    }

    return {
        sameMandal: false,
        sameDistrict: false,
        multiplier: 1,
        reason: null,
    };
};

const getPanchayatProximityScore = (jobPanchayat, workerPanchayat, distanceKm) => {
    const normalizedJob = normalizeKey(jobPanchayat);
    const normalizedWorker = normalizeKey(workerPanchayat);
    if (normalizedJob && normalizedWorker && normalizedJob === normalizedWorker) {
        return 1 + AP_VILLAGE_PROXIMITY_BOOST;
    }
    if (!Number.isFinite(Number(distanceKm))) return 1;
    if (Number.isFinite(Number(distanceKm)) && Number(distanceKm) <= 5) return 1 + AP_VILLAGE_PROXIMITY_BOOST;
    if (Number.isFinite(Number(distanceKm)) && Number(distanceKm) <= 15) return 0.99;
    return 0.93;
};

const tokenizeCategory = (value = '') => normalizeKey(value)
    .split(/[\s,/_|-]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const buildJobKeywordSet = (job = {}) => new Set([
    ...tokenizeCategory(job?.category),
    ...tokenizeCategory(job?.title),
    ...tokenizeCategory(Array.isArray(job?.requirements) ? job.requirements.join(' ') : job?.requirements),
    ...tokenizeCategory(job?.description),
]);

const keywordSetHasAny = (haystack, candidates) => (
    [...candidates].some((candidate) => {
        const normalized = normalizeKey(candidate);
        if (!normalized) return false;
        if (haystack.has(normalized)) return true;
        return [...haystack].some((token) => token.includes(normalized) || normalized.includes(token));
    })
);

const isAgricultureJob = (job = {}) => keywordSetHasAny(buildJobKeywordSet(job), AGRICULTURE_KEYWORDS);
const isVoiceJob = (job = {}) => keywordSetHasAny(buildJobKeywordSet(job), VOICE_KEYWORDS) || Boolean(job?.requiresVoice);
const isDigitalGigJob = (job = {}) => keywordSetHasAny(buildJobKeywordSet(job), DIGITAL_GIG_KEYWORDS);
const isVbgRamGJob = (job = {}) => keywordSetHasAny(buildJobKeywordSet(job), INFRA_KEYWORDS);

const getVbgRamGMultiplier = (job = {}, currentMonth = 1) => {
    const isPauseMonth = Array.isArray(VBG_RAM_G_CONFIG.pauseMonths)
        && VBG_RAM_G_CONFIG.pauseMonths.includes(Number(currentMonth));

    if (isPauseMonth && isVbgRamGJob(job)) return 0.92;
    if (isPauseMonth && isAgricultureJob(job)) return 1.12;
    if (isVbgRamGJob(job)) return 1.06;
    return 1;
};

const getDialectAffinityScore = (jobDialect, workerDialect, requiresVoice) => {
    if (!requiresVoice) return 1;

    const normalizedJobDialect = normalizeKey(jobDialect);
    const normalizedWorkerDialect = normalizeKey(workerDialect);
    if (!normalizedJobDialect || !normalizedWorkerDialect) return 0.88;
    if (normalizedJobDialect === normalizedWorkerDialect) return 1;

    const matrixRow = DIALECT_AFFINITY[normalizedJobDialect] || DIALECT_AFFINITY.telugu || {};
    return clamp(Number(matrixRow?.[normalizedWorkerDialect] || 0.82), 0.75, 1);
};

const getLanguageScore = ({ job = {}, workerLanguages = [] }) => {
    const languages = Array.isArray(workerLanguages) ? workerLanguages : [workerLanguages];
    const normalizedLanguages = languages.map((value) => normalizeKey(value)).filter(Boolean);
    const hasTelugu = normalizedLanguages.some((value) => value.includes('telugu') || value === 'te');
    const shouldPreferTelugu = isAgricultureJob(job) || [ZONE.RURAL, ZONE.AGRICULTURAL, ZONE.TRIBAL].includes(job?.zone);

    if (hasTelugu) return 1.02;
    if (!shouldPreferTelugu || normalizedLanguages.length === 0) return 1;

    return clamp(1 - (AP_LANGUAGE_PENALTY * 0.25), 0.85, 1);
};

const getApDistanceScore = ({ job = {}, worker = {}, scoringContext = {} }) => {
    if (!isApRelevant({ job, worker })) return null;

    const { jobPoint, workerPoint, jobLocationMeta, workerLocationMeta } = resolveApPoints({ job, worker });
    const lgdHierarchy = getLgdHierarchyMeta({ job, worker, jobLocationMeta, workerLocationMeta });
    const maxCommuteDistanceKm = deriveMaxCommuteKm({ worker, scoringContext });
    const toleranceEnabled = scoringContext?.distanceToleranceEnabled !== false;
    const fallbackScoreDefault = maxCommuteDistanceKm >= 40 ? AP_SPARSE_FALLBACK : 0.58;
    const fallbackScore = clamp01(scoringContext?.distanceFallbackScore ?? fallbackScoreDefault);

    if (!jobPoint || !workerPoint) {
        if (lgdHierarchy.sameMandal) {
            return {
                distanceScore: 1,
                outsideRadius: false,
                toleranceApplied: true,
                distanceKm: 0,
                distanceSource: 'lgd_hierarchy',
            };
        }
        if (lgdHierarchy.sameDistrict) {
            return {
                distanceScore: 0.82,
                outsideRadius: false,
                toleranceApplied: true,
                distanceKm: null,
                distanceSource: 'lgd_hierarchy',
            };
        }
        return null;
    }

    const distanceKm = haversineKm(jobPoint, workerPoint);
    if (!Number.isFinite(Number(distanceKm))) return null;

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
            distanceScore: clamp01(scoreDistanceKm(distanceKm) ?? 0.36),
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

const extractRequiredExperience = (requirements = []) => {
    const source = Array.isArray(requirements) ? requirements.join(' ') : String(requirements || '');
    const rangeMatch = source.match(/(\d+)\s*-\s*(\d+)\s*years?/i);
    if (rangeMatch) return Math.min(Number(rangeMatch[1] || 0), Number(rangeMatch[2] || 0));

    const plusMatch = source.match(/(\d+)\s*\+\s*years?/i);
    if (plusMatch) return Number(plusMatch[1] || 0);

    const singleMatch = source.match(/(\d+)\s+years?/i);
    return Number(singleMatch?.[1] || 0);
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

    const { jobLocationMeta, workerLocationMeta } = resolveApPoints({ job, worker });
    if (!jobLocationMeta && !workerLocationMeta) {
        const hasLgdContext = Boolean(job?.mandalLgd || job?.districtLgd || worker?.mandalLgd || worker?.districtLgd);
        if (!hasLgdContext) return null;
    }

    const jobZone = jobLocationMeta?.zone || null;
    const workerZone = workerLocationMeta?.zone || null;
    const isRuralContext = [jobZone, workerZone].some((zone) => (
        zone === ZONE.RURAL || zone === ZONE.AGRICULTURAL || zone === ZONE.TRIBAL
    ));

    const reasons = [];
    const signals = {};
    let multiplier = 1;

    if (isRuralContext) {
        multiplier *= 1 + AP_RURAL_BOOST;
        reasons.push('AP_RURAL_BOOST');
    }

    const panchayatBoost = getPanchayatProximityScore(
        job?.panchayat || jobLocationMeta?.panchayat,
        worker?.panchayat || workerLocationMeta?.panchayat,
        distanceKm
    );
    multiplier *= panchayatBoost;
    if (panchayatBoost > 1) {
        reasons.push('AP_PANCHAYAT_PROXIMITY');
    }
    signals.panchayatBoost = panchayatBoost;

    const lgdHierarchy = getLgdHierarchyMeta({ job, worker, jobLocationMeta, workerLocationMeta });
    multiplier *= lgdHierarchy.multiplier;
    if (lgdHierarchy.reason) reasons.push(lgdHierarchy.reason);
    signals.lgdHierarchy = lgdHierarchy;

    const currentMonth = new Date(scoringContext?.timestamp || Date.now()).getMonth() + 1;
    const seasonalBoost = job?.seasonalHarvest && Array.isArray(VBG_RAM_G_CONFIG.pauseMonths)
        && VBG_RAM_G_CONFIG.pauseMonths.includes(currentMonth)
        ? AP_SEASONAL_HARVEST_BOOST
        : 1;
    multiplier *= seasonalBoost;
    if (seasonalBoost > 1) reasons.push('AP_SEASONAL_HARVEST');
    signals.seasonalBoost = seasonalBoost;

    const vbgMultiplier = getVbgRamGMultiplier(job, currentMonth);
    multiplier *= vbgMultiplier;
    if (vbgMultiplier !== 1) reasons.push(vbgMultiplier > 1 ? 'AP_VBG_REDIRECT' : 'AP_VBG_PAUSE_SOFTEN');
    signals.vbgMultiplier = vbgMultiplier;

    const smartphoneBoost = (
        Boolean(worker?.hasSmartphone || worker?.smartphoneUser)
        && (isDigitalGigJob(job) || isVoiceJob(job) || isRuralContext)
    ) ? AP_SMARTPHONE_GIG_BOOST : 1;
    multiplier *= smartphoneBoost;
    if (smartphoneBoost > 1) reasons.push('AP_SMARTPHONE_GIG_BOOST');
    signals.smartphoneBoost = smartphoneBoost;

    const dialectScore = getDialectAffinityScore(job?.dialectTarget, worker?.dialect, Boolean(job?.requiresVoice || isVoiceJob(job)));
    multiplier *= dialectScore;
    if (dialectScore < 1) reasons.push('AP_DIALECT_FIT');
    signals.dialectScore = dialectScore;

    const roleExperience = Number(
        roleData?.experienceInRole
        ?? worker?.experienceInRole
        ?? worker?.totalExperience
        ?? 0
    );
    const trainabilityBonus = requiredExp > 0 && roleExperience >= 0 && roleExperience < requiredExp * 0.6
        ? 1 + AP_TRAINABILITY_BONUS
        : 1;
    multiplier *= trainabilityBonus;
    if (trainabilityBonus > 1) reasons.push('AP_TRAINABILITY_BONUS');
    signals.trainabilityBonus = trainabilityBonus;

    const genderPenalty = (
        normalizeKey(worker?.gender) === 'female'
        && Number.isFinite(Number(distanceKm))
        && Number(distanceKm) > 15
        && isRuralContext
    ) ? AP_GENDER_MOBILITY_PENALTY : 1;
    multiplier *= genderPenalty;
    if (genderPenalty < 1) reasons.push('AP_GENDER_MOBILITY');
    signals.genderPenalty = genderPenalty;

    const informalDecay = worker?.mgnregaHistory ? AP_MGNREGA_DECAY : 1;
    multiplier *= informalDecay;
    if (informalDecay < 1) reasons.push('AP_MGNREGA_DECAY');
    signals.informalDecay = informalDecay;

    const panchayatRepBoost = worker?.localPanchayatReputation ? 1 + AP_PANCHAYAT_REPUTATION_BOOST : 1;
    multiplier *= panchayatRepBoost;
    if (panchayatRepBoost > 1) reasons.push('AP_PANCHAYAT_REPUTATION');
    signals.panchayatRepBoost = panchayatRepBoost;

    const languageScore = getLanguageScore({
        job: { ...job, zone: jobZone || job?.zone || null },
        workerLanguages: worker?.languages || workerUser?.languages || workerUser?.language || worker?.language || [],
    });
    multiplier *= languageScore;
    if (languageScore !== 1) reasons.push(languageScore > 1 ? 'AP_TELUGU_LANGUAGE' : 'AP_LANGUAGE_PENALTY');
    signals.languageScore = languageScore;

    const cappedMultiplier = clamp(multiplier, 0.82, 1.15);

    return {
        apEngineVersion: AP_ENGINE_VERSION,
        multiplier: cappedMultiplier,
        uncappedMultiplier: Number(multiplier.toFixed(6)),
        reasons,
        signals,
        job: {
            zone: jobZone,
            district: jobLocationMeta?.district || job?.district || null,
            mandal: jobLocationMeta?.mandal || job?.mandal || null,
            panchayat: jobLocationMeta?.panchayat || job?.panchayat || null,
            lgdCode: jobLocationMeta?.lgdCode || job?.mandalLgd || job?.districtLgd || null,
            name: jobLocationMeta?.name || jobLocationMeta?.n || null,
        },
        worker: {
            zone: workerZone,
            district: workerLocationMeta?.district || worker?.district || null,
            mandal: workerLocationMeta?.mandal || worker?.mandal || null,
            panchayat: workerLocationMeta?.panchayat || worker?.panchayat || null,
            lgdCode: workerLocationMeta?.lgdCode || worker?.mandalLgd || worker?.districtLgd || null,
            name: workerLocationMeta?.name || workerLocationMeta?.n || null,
        },
        distanceKm: Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : null,
        adjacencyHints: Array.from(
            AP_ADJACENCY_GRAPH.get(normalizeKey(jobLocationMeta?.mandal || job?.mandal || '')) || []
        ),
    };
};

const mapTier = (score) => {
    const normalized = clamp01(score);
    if (normalized >= TIERS.STRONG) return 'STRONG';
    if (normalized >= TIERS.GOOD) return 'GOOD';
    if (normalized >= TIERS.POSSIBLE) return 'POSSIBLE';
    return 'REJECT';
};

const buildCompositeInput = ({ job = {}, worker = {}, workerUser = {}, roleData = {} }) => {
    const requiredExp = extractRequiredExperience(job?.requirements || []);
    return {
        profile: {
            id: worker?._id,
            userId: workerUser?._id || worker?.user?._id || worker?.user,
            name: [worker?.firstName, worker?.lastName].filter(Boolean).join(' ') || workerUser?.name || '',
            city: worker?.city || worker?.location || worker?.district || '',
            location: worker?.city || worker?.location || worker?.district || '',
            roleName: roleData?.roleName,
            expectedSalary: roleData?.expectedSalary,
            salary_expectations: roleData?.expectedSalary,
            experienceInRole: roleData?.experienceInRole,
            experience_years: roleData?.experienceInRole,
            skills: roleData?.skills || [],
            preferredShift: roleData?.preferredShift || worker?.preferredShift || '',
            education: roleData?.education || worker?.education || workerUser?.education || '',
            dialect: worker?.dialect || '',
        },
        job: {
            id: job?._id,
            title: job?.title,
            location: job?.location || job?.district || '',
            jobLocation: job?.location || job?.district || '',
            remoteAllowed: Boolean(job?.remoteAllowed || job?.remote),
            jobLocationType: job?.jobLocationType,
            description: Array.isArray(job?.requirements) ? job.requirements.join(', ') : String(job?.requirements || ''),
            requirements: Array.isArray(job?.requirements) ? job.requirements : [],
            required_skills: Array.isArray(job?.requiredSkills) ? job.requiredSkills : [],
            skills: Array.isArray(job?.requiredSkills) ? job.requiredSkills : [],
            maxSalary: job?.maxSalary || job?.salaryMax || 0,
            salaryRange: job?.salaryRange || '',
            experience_required: requiredExp > 0 ? `${requiredExp} years` : '',
            education_required: job?.educationRequired || job?.education || '',
            category: job?.category || '',
            requiresVoice: Boolean(job?.requiresVoice),
        },
    };
};

const evaluateAPRoleAgainstJob = ({ job = {}, worker = {}, workerUser = {}, roleData = {}, scoringContext = {} }) => {
    const compositeInput = buildCompositeInput({ job, worker, workerUser, roleData });
    const composite = evaluateCompositeMatch(compositeInput);
    const distanceResolution = getApDistanceScore({ job, worker, scoringContext });
    const requiredExp = extractRequiredExperience(job?.requirements || []);
    const regional = getApRegionalAdjustment({
        job,
        worker,
        workerUser,
        roleData,
        scoringContext,
        distanceKm: distanceResolution?.distanceKm ?? null,
        requiredExp,
    });

    const distanceScore = clamp01(distanceResolution?.distanceScore ?? 0.8);
    const baseScore = clamp01((Number(composite?.finalScore || 0) * 0.78) + (distanceScore * 0.22));
    const finalScore = clamp01(baseScore * (Number(regional?.multiplier) || 1));
    const tier = mapTier(finalScore);

    return {
        accepted: tier !== 'REJECT',
        finalScore,
        baseScore,
        tier,
        distanceScore,
        distanceKm: Number.isFinite(Number(distanceResolution?.distanceKm)) ? Number(distanceResolution.distanceKm) : null,
        explainability: {
            baseScore,
            distanceScore,
            semanticCompositeScore: clamp01(composite?.finalScore ?? 0),
            apRegional: regional ? {
                engineVersion: regional.apEngineVersion,
                multiplier: regional.multiplier,
                uncappedMultiplier: regional.uncappedMultiplier,
                reasons: regional.reasons,
                signals: regional.signals,
                job: regional.job,
                worker: regional.worker,
                distanceKm: regional.distanceKm,
            } : null,
        },
    };
};

const rankJobsForAPWorker = ({ worker = {}, workerUser = {}, roleData = null, jobs = [], maxResults = 20, scoringContextResolver = null }) => {
    const safeRoleData = roleData || (Array.isArray(worker?.roleProfiles) ? worker.roleProfiles.find((row) => row?.activeProfile) || worker.roleProfiles[0] : null);
    if (!safeRoleData) return [];

    return jobs
        .map((job) => {
            const scoringContext = typeof scoringContextResolver === 'function' ? scoringContextResolver(job) : {};
            return {
                job,
                evaluation: evaluateAPRoleAgainstJob({
                    job,
                    worker,
                    workerUser,
                    roleData: safeRoleData,
                    scoringContext,
                }),
            };
        })
        .filter((row) => row.evaluation.accepted)
        .sort((left, right) => right.evaluation.finalScore - left.evaluation.finalScore)
        .slice(0, Math.max(0, Number(maxResults) || 20));
};

const rankAPWorkersForJob = ({ job = {}, candidates = [], maxResults = 20, scoringContextResolver = null }) => (
    candidates
        .map((candidate) => {
            const worker = candidate?.worker || {};
            const workerUser = candidate?.user || worker?.user || {};
            const roleData = Array.isArray(worker?.roleProfiles)
                ? worker.roleProfiles.find((row) => row?.activeProfile) || worker.roleProfiles[0]
                : null;

            if (!roleData) {
                return {
                    candidate,
                    evaluation: { accepted: false, finalScore: 0 },
                };
            }

            const scoringContext = typeof scoringContextResolver === 'function'
                ? scoringContextResolver({ job, candidate })
                : {};

            return {
                candidate,
                evaluation: evaluateAPRoleAgainstJob({
                    job,
                    worker,
                    workerUser,
                    roleData,
                    scoringContext,
                }),
            };
        })
        .filter((row) => row.evaluation.accepted)
        .sort((left, right) => right.evaluation.finalScore - left.evaluation.finalScore)
        .slice(0, Math.max(0, Number(maxResults) || 20))
);

module.exports = {
    AP_ENGINE_VERSION,
    resolveApLocation,
    resolveApLocationFromEntity,
    getApDistanceScore,
    getApRegionalAdjustment,
    evaluateAPRoleAgainstJob,
    rankJobsForAPWorker,
    rankAPWorkersForJob,
};
