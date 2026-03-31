const ApiKey = require('../models/ApiKey');
const Job = require('../models/Job');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const { extractApiKeyFromRequest } = require('../services/externalApiKeyService');
const { buildCacheKey, getJSON, setJSON, CACHE_TTL_SECONDS } = require('../services/cacheService');
const { resolveRoutingContext, chooseRegionWithFallback } = require('../services/regionRoutingService');

const DAILY_REQUEST_CAP_BY_TIER = Object.freeze({
    basic: Number.parseInt(process.env.PARTNER_API_DAILY_CAP_BASIC || '1000', 10),
    pro: Number.parseInt(process.env.PARTNER_API_DAILY_CAP_PRO || '10000', 10),
    enterprise: Number.parseInt(process.env.PARTNER_API_DAILY_CAP_ENTERPRISE || '250000', 10),
});

const LEGACY_TIER_MAP = Object.freeze({
    free: 'basic',
    partner: 'pro',
    enterprise: 'enterprise',
});

const normalizeTier = (apiKeyDoc = {}) => {
    const direct = String(apiKeyDoc.rateLimitTier || '').trim().toLowerCase();
    if (DAILY_REQUEST_CAP_BY_TIER[direct]) return direct;

    const legacy = String(apiKeyDoc.tier || apiKeyDoc.planType || 'free').trim().toLowerCase();
    return LEGACY_TIER_MAP[legacy] || 'basic';
};

const resolveDailyCap = (tier) => DAILY_REQUEST_CAP_BY_TIER[tier] || DAILY_REQUEST_CAP_BY_TIER.basic;

const getIncomingApiKey = (req) => String(extractApiKeyFromRequest(req) || '').trim();

const protectApiKey = async (req, res, next) => {
    const incomingKey = getIncomingApiKey(req);

    if (!incomingKey) {
        return res.status(401).json({ message: 'Not authorized, no API key' });
    }

    try {
        const hashed = ApiKey.hashApiKeyValue(incomingKey);

        const apiKeyDoc = await ApiKey.findOne({
            $or: [
                { key: hashed },
                { keyPattern: incomingKey },
            ],
            revoked: { $ne: true },
            isActive: { $ne: false },
        });

        if (!apiKeyDoc) {
            return res.status(401).json({ message: 'Not authorized, invalid API key' });
        }

        const todayStr = new Date().toDateString();
        const lastResetStr = new Date(apiKeyDoc.lastResetDate).toDateString();

        if (todayStr !== lastResetStr) {
            apiKeyDoc.requestsToday = 0;
            apiKeyDoc.lastResetDate = new Date();
        }

        const tier = normalizeTier(apiKeyDoc);
        const maxRequests = resolveDailyCap(tier);

        if (apiKeyDoc.requestsToday >= maxRequests) {
            return res.status(429).json({ message: 'Daily API usage cap exceeded for this partner tier.' });
        }

        apiKeyDoc.requestsToday += 1;
        apiKeyDoc.lastUsedAt = new Date();
        await apiKeyDoc.save();

        req.apiKey = apiKeyDoc;
        req.apiTier = tier;
        req.employerId = apiKeyDoc.employerId || apiKeyDoc.ownerId || null;
        next();
    } catch (_error) {
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const buildPublicJobsQuery = ({ region = null, country = null } = {}) => {
    const query = {
        isOpen: true,
        status: 'active',
        isArchived: { $ne: true },
        isDisabled: { $ne: true },
    };

    const normalizedCountry = String(country || '').trim().toUpperCase();
    const normalizedRegion = String(region || '').trim().toUpperCase();

    if (normalizedCountry) query.countryCode = normalizedCountry;
    if (normalizedRegion) query.regionCode = normalizedRegion;

    return query;
};

// @desc Get public jobs payload
// @route GET /api/public/jobs
const getPublicJobsList = async (req, res) => {
    try {
        const requestedRegion = String(req.query.region || req.headers['x-region'] || '').trim();
        const requestedCountry = String(req.query.country || req.headers['x-country-code'] || '').trim().toUpperCase();
        const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || '50', 10)));

        const routing = resolveRoutingContext({
            user: {
                primaryRegion: requestedRegion || process.env.APP_REGION,
            },
            requestedRegion,
        });
        const routeChoice = chooseRegionWithFallback({
            preferredRegion: requestedRegion || routing.primaryRegion,
            allowedRegions: [routing.primaryRegion, ...routing.failoverRegions],
        });

        const query = buildPublicJobsQuery({
            region: routeChoice.region,
            country: requestedCountry,
        });

        const cacheKey = buildCacheKey('public_jobs', {
            tier: req.apiTier,
            region: routeChoice.region,
            country: requestedCountry || null,
            limit,
        });

        const cached = await getJSON(cacheKey);
        if (cached && Array.isArray(cached.data)) {
            res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');
            res.setHeader('Vary', 'x-region, x-country-code');
            return res.json({
                ...cached,
                cached: true,
            });
        }

        let jobs = await Job.find(query)
            .select('title companyName location salaryRange createdAt regionCode countryCode remoteAllowed')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        if (!jobs.length && routeChoice.usedFallback && routing.primaryRegion !== routeChoice.region) {
            const primaryQuery = buildPublicJobsQuery({
                region: routing.primaryRegion,
                country: requestedCountry,
            });
            jobs = await Job.find(primaryQuery)
                .select('title companyName location salaryRange createdAt regionCode countryCode remoteAllowed')
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
        }

        const payload = {
            status: 'success',
            results: jobs.length,
            region: routeChoice.region,
            usedFallbackRegion: routeChoice.usedFallback,
            data: jobs,
        };

        await setJSON(cacheKey, payload, CACHE_TTL_SECONDS.jobs).catch(() => {});

        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');
        res.setHeader('Vary', 'x-region, x-country-code');

        return res.json(payload);
    } catch (_error) {
        return res.status(500).json({ message: 'Public API Error' });
    }
};

// @desc Stub for webhook registration
// @route POST /api/public/webhooks
const registerWebhook = async (req, res) => {
    const { eventType, targetUrl } = req.body;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ message: 'Webhook successfully registered', eventType, targetUrl, active: true });
};

// @desc Public profile view (safe fields only)
// @route GET /api/public/profile/:userId
const getPublicProfileView = async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const cacheKey = buildCacheKey('public_profile', { userId });
        const cached = await getJSON(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                cached: true,
            });
        }

        const user = await User.findById(userId)
            .select('name role activeRole primaryRole city country hasCompletedProfile')
            .lean();

        if (!user || user.isDeleted || user.isBanned) {
            return res.status(404).json({ message: 'Profile not found' });
        }

        const [workerProfile, employerProfile] = await Promise.all([
            WorkerProfile.findOne({ user: userId })
                .select('firstName lastName city country totalExperience roleProfiles interviewVerified')
                .lean(),
            EmployerProfile.findOne({ user: userId })
                .select('companyName industry location country logoUrl website')
                .lean(),
        ]);

        const isEmployer = String(user.activeRole || user.primaryRole || '').toLowerCase() === 'employer';
        const safePayload = {
            success: true,
            data: {
                user: {
                    id: String(user._id),
                    name: String(user.name || ''),
                    role: isEmployer ? 'employer' : 'worker',
                    city: user.city || null,
                    country: user.country || null,
                    hasCompletedProfile: Boolean(user.hasCompletedProfile),
                },
                profile: isEmployer
                    ? {
                        companyName: employerProfile?.companyName || '',
                        industry: employerProfile?.industry || '',
                        location: employerProfile?.location || '',
                        country: employerProfile?.country || user.country || null,
                        logoUrl: employerProfile?.logoUrl || null,
                        website: employerProfile?.website || null,
                    }
                    : {
                        firstName: workerProfile?.firstName || '',
                        lastName: workerProfile?.lastName || '',
                        city: workerProfile?.city || user.city || null,
                        country: workerProfile?.country || user.country || null,
                        totalExperience: Number(workerProfile?.totalExperience || 0),
                        interviewVerified: Boolean(workerProfile?.interviewVerified),
                        roleProfiles: Array.isArray(workerProfile?.roleProfiles)
                            ? workerProfile.roleProfiles.slice(0, 3).map((row) => ({
                                roleName: row.roleName || '',
                                experienceInRole: Number(row.experienceInRole || 0),
                                skills: Array.isArray(row.skills) ? row.skills.slice(0, 20) : [],
                            }))
                            : [],
                    },
            },
        };

        await setJSON(cacheKey, safePayload, CACHE_TTL_SECONDS.profile).catch(() => {});
        return res.json(safePayload);
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load public profile' });
    }
};

module.exports = {
    protectApiKey,
    getPublicJobsList,
    getPublicProfileView,
    registerWebhook,
};
