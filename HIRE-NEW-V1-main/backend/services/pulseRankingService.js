const { getNormalizedLocationParts } = require('../utils/locationFields');

const MAX_RECENCY_HOURS = 72;

const normalizeTimestamp = (value) => {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const computeRecencyWeight = (createdAt) => {
    const timestamp = normalizeTimestamp(createdAt);
    if (!timestamp) return 0;
    const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
    if (!Number.isFinite(ageHours) || ageHours <= 0) return 1;
    return Math.max(0, 1 - (ageHours / MAX_RECENCY_HOURS));
};

const resolveViewerLocation = (viewerLocation = {}) => {
    const normalized = getNormalizedLocationParts(viewerLocation);
    return {
        district: normalized.district,
        mandal: normalized.mandal,
        locationLabel: normalized.locationLabel,
        hasLocation: Boolean(normalized.district || normalized.mandal || normalized.locationLabel),
    };
};

const computeLocalityTier = (viewerLocation = {}, item = {}) => {
    const viewer = resolveViewerLocation(viewerLocation);
    const target = getNormalizedLocationParts(item);

    if (!viewer.hasLocation) return 0;

    const sameDistrict = Boolean(viewer.district && target.district && viewer.district === target.district);
    const sameMandal = Boolean(viewer.mandal && target.mandal && viewer.mandal === target.mandal);
    const locationLabelOverlap = Boolean(
        viewer.locationLabel
        && target.locationLabel
        && (
            target.locationLabel.includes(viewer.locationLabel)
            || viewer.locationLabel.includes(target.locationLabel)
        )
    );

    if (sameDistrict && sameMandal) return 4;
    if (sameDistrict && viewer.mandal && !target.mandal && locationLabelOverlap) return 3;
    if (sameDistrict) return 2;
    if (locationLabelOverlap) return 1;
    return 0;
};

const computePulseRank = (item = {}, viewerLocation = {}) => {
    const localityTier = computeLocalityTier(viewerLocation, item);
    const engagementScore = Number(item?.engagementScore || 0);
    const interactionCount = Number(item?.interactionCount || 0);
    const recencyWeight = computeRecencyWeight(item?.createdAt || item?.timePosted);
    const isJob = String(item?.postType || '').toLowerCase() === 'job' || Boolean(String(item?.jobId || '').trim());
    const urgentBoost = Boolean(item?.urgent) ? 2 : 0;
    const jobBoost = isJob ? 1.5 : 0;
    const rank = (localityTier * 100)
        + (urgentBoost * 10)
        + (jobBoost * 5)
        + (engagementScore * 2)
        + recencyWeight
        + Math.min(interactionCount, 100) / 1000;

    return {
        localityTier,
        pulseRank: Number(rank.toFixed(4)),
    };
};

const rankPulseItemsByViewerLocation = ({ items = [], viewerLocation = {} } = {}) => {
    const safeItems = Array.isArray(items) ? items : [];

    return safeItems
        .map((item, index) => {
            const { localityTier, pulseRank } = computePulseRank(item, viewerLocation);
            return {
                ...item,
                localityTier,
                pulseRank,
                pulseRankSource: localityTier > 0 ? 'viewer_locality' : 'engagement_fallback',
                _originalIndex: index,
            };
        })
        .sort((left, right) => {
            if (right.pulseRank !== left.pulseRank) return right.pulseRank - left.pulseRank;
            const rightCreatedAt = normalizeTimestamp(right.createdAt || right.timePosted);
            const leftCreatedAt = normalizeTimestamp(left.createdAt || left.timePosted);
            if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
            if (right.interactionCount !== left.interactionCount) {
                return Number(right.interactionCount || 0) - Number(left.interactionCount || 0);
            }
            return left._originalIndex - right._originalIndex;
        })
        .map(({ _originalIndex, ...item }) => item);
};

module.exports = {
    computeLocalityTier,
    computePulseRank,
    rankPulseItemsByViewerLocation,
    resolveViewerLocation,
};
