const RegionMetrics = require('../models/RegionMetrics');
const User = require('../models/userModel');
const Application = require('../models/Application');
const RevenueEvent = require('../models/RevenueEvent');

const DEFAULT_REGION = 'GLOBAL';

const normalizeRegion = (value) => String(value || DEFAULT_REGION).trim().toUpperCase() || DEFAULT_REGION;
const normalizeCountry = (value) => String(value || 'GLOBAL').trim().toUpperCase() || 'GLOBAL';

const upsertRegionMetrics = async ({
    region,
    country = 'GLOBAL',
    activeUsers = 0,
    hires = 0,
    revenue = 0,
    engagement = 0,
    capturedAt = new Date(),
    metadata = {},
}) => {
    const normalizedRegion = normalizeRegion(region);
    const normalizedCountry = normalizeCountry(country);

    return RegionMetrics.create({
        region: normalizedRegion,
        country: normalizedCountry,
        activeUsers: Number(activeUsers || 0),
        hires: Number(hires || 0),
        revenue: Number(revenue || 0),
        engagement: Number(engagement || 0),
        capturedAt,
        metadata,
    });
};

const snapshotRegionMetrics = async ({ region, country = 'GLOBAL' }) => {
    const normalizedRegion = normalizeRegion(region);
    const normalizedCountry = normalizeCountry(country);

    const userFilters = {
        ...(normalizedCountry === 'GLOBAL' ? {} : { country: normalizedCountry }),
        ...(normalizedRegion === 'GLOBAL' ? {} : { state: normalizedRegion }),
    };

    const [activeUsers, hires, revenueAgg] = await Promise.all([
        User.countDocuments({
            ...userFilters,
            isDeleted: { $ne: true },
        }),
        Application.countDocuments({
            status: 'hired',
        }),
        RevenueEvent.aggregate([
            {
                $match: {
                    status: 'succeeded',
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$amountBase', '$amountInr'] } },
                },
            },
        ]),
    ]);

    const engagement = Math.min(1, Math.max(0, activeUsers > 0 ? hires / activeUsers : 0));

    return upsertRegionMetrics({
        region: normalizedRegion,
        country: normalizedCountry,
        activeUsers,
        hires,
        revenue: Number(revenueAgg?.[0]?.total || 0),
        engagement,
        metadata: {
            source: 'snapshot',
        },
    });
};

const listRegionMetrics = async ({ region = null, country = null, limit = 100 } = {}) => {
    const query = {};
    if (region) query.region = normalizeRegion(region);
    if (country) query.country = normalizeCountry(country);

    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    return RegionMetrics.find(query)
        .sort({ capturedAt: -1 })
        .limit(safeLimit)
        .lean();
};

module.exports = {
    upsertRegionMetrics,
    snapshotRegionMetrics,
    listRegionMetrics,
};
