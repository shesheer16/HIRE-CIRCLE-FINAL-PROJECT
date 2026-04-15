const Application = require('../models/Application');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const RegionDominanceSnapshot = require('../models/RegionDominanceSnapshot');
const User = require('../models/userModel');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeRegion = (value) => String(value || 'GLOBAL').trim().toUpperCase() || 'GLOBAL';
const normalizeCountry = (value) => String(value || 'GLOBAL').trim().toUpperCase() || 'GLOBAL';

const buildKey = ({ region, country }) => `${normalizeCountry(country)}::${normalizeRegion(region)}`;

const inferMarketBand = (dominanceScore) => {
    if (dominanceScore >= 0.75) return 'dominant';
    if (dominanceScore >= 0.5) return 'balanced';
    if (dominanceScore >= 0.3) return 'weak';
    return 'critical';
};

const deriveWeaknessSignals = ({ activeUsers, activeJobs, hireDensity }) => {
    const signals = [];
    if (activeUsers < 200) signals.push('low_user_base');
    if (activeJobs < 50) signals.push('low_active_jobs');
    if (hireDensity < 0.03) signals.push('low_hire_density');
    if (hireDensity > 0.35) signals.push('under_supply_pressure');
    return signals;
};

const shouldTriggerCampaign = (marketBand, weaknessSignals = []) => (
    ['weak', 'critical'].includes(String(marketBand || ''))
    && weaknessSignals.length > 0
);

const triggerGrowthCampaignAlert = async ({ region, country, marketBand, weaknessSignals, snapshotId }) => {
    const now = Date.now();
    const since = new Date(now - (24 * 60 * 60 * 1000));

    const duplicate = await Notification.findOne({
        type: 'growth_campaign_trigger',
        'relatedData.region': region,
        createdAt: { $gte: since },
    })
        .select('_id')
        .lean();

    if (duplicate) return false;

    const admins = await User.find({ isAdmin: true }).select('_id').lean();
    if (!admins.length) return false;

    await Notification.insertMany(admins.map((admin) => ({
        user: admin._id,
        type: 'growth_campaign_trigger',
        title: `Growth Campaign Trigger: ${region}`,
        message: `Market band=${marketBand}. Auto campaign queued for ${country}/${region}.`,
        relatedData: {
            region,
            country,
            marketBand,
            weaknessSignals,
            snapshotId: String(snapshotId),
        },
        isRead: false,
    })));

    return true;
};

const computeRegionDominance = async ({ limit = 200 } = {}) => {
    const [userRows, jobRows, hireRows] = await Promise.all([
        User.aggregate([
            { $match: { isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: {
                        region: { $ifNull: ['$state', 'GLOBAL'] },
                        country: { $ifNull: ['$country', 'GLOBAL'] },
                    },
                    activeUsers: { $sum: 1 },
                },
            },
        ]),
        Job.aggregate([
            {
                $match: {
                    status: 'active',
                    isOpen: true,
                },
            },
            {
                $group: {
                    _id: {
                        region: { $ifNull: ['$regionCode', '$location'] },
                        country: { $ifNull: ['$countryCode', '$country'] },
                    },
                    activeJobs: { $sum: 1 },
                },
            },
        ]),
        Application.aggregate([
            { $match: { status: 'hired' } },
            {
                $lookup: {
                    from: Job.collection.name,
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: '$jobDoc' },
            {
                $group: {
                    _id: {
                        region: { $ifNull: ['$jobDoc.regionCode', '$jobDoc.location'] },
                        country: { $ifNull: ['$jobDoc.countryCode', '$jobDoc.country'] },
                    },
                    hires: { $sum: 1 },
                },
            },
        ]),
    ]);

    const rollup = new Map();
    const upsertRollup = ({ region, country }) => {
        const key = buildKey({ region, country });
        if (!rollup.has(key)) {
            rollup.set(key, {
                region: normalizeRegion(region),
                country: normalizeCountry(country),
                activeUsers: 0,
                activeJobs: 0,
                hires: 0,
            });
        }
        return rollup.get(key);
    };

    userRows.forEach((row) => {
        const current = upsertRollup({ region: row?._id?.region, country: row?._id?.country });
        current.activeUsers = Number(row.activeUsers || 0);
    });

    jobRows.forEach((row) => {
        const current = upsertRollup({ region: row?._id?.region, country: row?._id?.country });
        current.activeJobs = Number(row.activeJobs || 0);
    });

    hireRows.forEach((row) => {
        const current = upsertRollup({ region: row?._id?.region, country: row?._id?.country });
        current.hires = Number(row.hires || 0);
    });

    const records = [];
    const capturedAt = new Date();

    for (const regionData of rollup.values()) {
        const activeUsers = Number(regionData.activeUsers || 0);
        const activeJobs = Number(regionData.activeJobs || 0);
        const hires = Number(regionData.hires || 0);
        const hireDensity = Number((hires / Math.max(activeJobs, 1)).toFixed(4));

        const userComponent = clamp(activeUsers / 5000, 0, 1);
        const jobComponent = clamp(activeJobs / 1200, 0, 1);
        const densityComponent = clamp(hireDensity / 0.25, 0, 1);
        const dominanceScore = Number(((userComponent * 0.4) + (jobComponent * 0.25) + (densityComponent * 0.35)).toFixed(4));

        const marketBand = inferMarketBand(dominanceScore);
        const weaknessSignals = deriveWeaknessSignals({ activeUsers, activeJobs, hireDensity });

        const snapshot = await RegionDominanceSnapshot.create({
            region: regionData.region,
            country: regionData.country,
            activeUsers,
            activeJobs,
            hires,
            hireDensity,
            dominanceScore,
            marketBand,
            weaknessSignals,
            campaignTriggered: false,
            capturedAt,
            metadata: {
                source: 'market_intelligence_shield',
            },
        });

        const campaignTriggered = shouldTriggerCampaign(marketBand, weaknessSignals)
            ? await triggerGrowthCampaignAlert({
                region: regionData.region,
                country: regionData.country,
                marketBand,
                weaknessSignals,
                snapshotId: snapshot._id,
            })
            : false;

        if (campaignTriggered) {
            await RegionDominanceSnapshot.updateOne(
                { _id: snapshot._id },
                { $set: { campaignTriggered: true } }
            );
        }

        records.push({
            ...snapshot.toObject(),
            campaignTriggered,
        });
    }

    return records
        .sort((left, right) => Number(left.dominanceScore || 0) - Number(right.dominanceScore || 0))
        .slice(0, Math.max(1, Math.min(500, Number(limit || 200))));
};

const getLatestRegionDominance = async ({ limit = 100, marketBand = null } = {}) => {
    const query = {};
    if (marketBand) {
        query.marketBand = String(marketBand).toLowerCase();
    }

    const rows = await RegionDominanceSnapshot.find(query)
        .sort({ capturedAt: -1, dominanceScore: 1 })
        .limit(Math.max(1, Math.min(500, Number(limit || 100))))
        .lean();

    return rows;
};

module.exports = {
    computeRegionDominance,
    getLatestRegionDominance,
};
