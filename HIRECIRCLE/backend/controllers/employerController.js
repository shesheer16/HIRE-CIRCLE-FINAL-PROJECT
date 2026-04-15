const { computeEmployerTierForEmployer, getEmployerTier } = require('../services/employerTierService');
const { getEmployerLockInSummary } = require('../services/lockInService');
const { buildCacheKey, getJSON, setJSON, CACHE_TTL_SECONDS } = require('../services/cacheService');
const {
    registerWebhookSubscription,
    listWebhookSubscriptions,
} = require('../services/platformWebhookService');
const Application = require('../models/Application');
const Job = require('../models/Job');
const MatchLog = require('../models/MatchLog');

// @desc Get employer quality tier
// @route GET /api/employer/tier
// @access Protected (Recruiter)
const getEmployerTierController = async (req, res) => {
    try {
        const forceRefresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
        const tier = forceRefresh
            ? await computeEmployerTierForEmployer({ employerId: req.user._id, upsert: true })
            : await getEmployerTier({ employerId: req.user._id, computeIfMissing: true });

        return res.json({
            success: true,
            data: tier,
        });
    } catch (error) {
        console.warn('Get employer tier error:', error);
        return res.status(500).json({ message: 'Failed to load employer tier' });
    }
};

// @desc Get employer lock-in summary
// @route GET /api/employer/lock-in-summary
// @access Protected (Recruiter)
const getEmployerLockInSummaryController = async (req, res) => {
    try {
        const cacheKey = buildCacheKey('analytics:employer-summary', {
            employerId: String(req.user._id),
        });
        const cached = await getJSON(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const data = await getEmployerLockInSummary({ employerId: req.user._id });
        const responsePayload = {
            success: true,
            data,
        };
        await setJSON(cacheKey, responsePayload, CACHE_TTL_SECONDS.analytics);
        return res.json(responsePayload);
    } catch (error) {
        console.warn('Get employer lock-in summary error:', error);
        return res.status(500).json({ message: 'Failed to load employer lock-in summary' });
    }
};

// @desc Get employer analytics metrics
// @route GET /api/employer/metrics
// @access Protected (Recruiter)
const getEmployerAnalyticsMetricsController = async (req, res) => {
    try {
        const employerId = req.user._id;
        const [totalApplicants, acceptedCount, hiredDurationAgg, jobs] = await Promise.all([
            Application.countDocuments({ employer: employerId }),
            Application.countDocuments({ employer: employerId, status: { $in: ['offer_accepted', 'hired'] } }),
            Application.aggregate([
                {
                    $match: {
                        employer: employerId,
                        status: 'hired',
                        createdAt: { $type: 'date' },
                        hiredAt: { $type: 'date' },
                    },
                },
                {
                    $project: {
                        durationHours: {
                            $divide: [
                                { $subtract: ['$hiredAt', '$createdAt'] },
                                1000 * 60 * 60,
                            ],
                        },
                    },
                },
                {
                    $group: {
                        _id: null,
                        avgHours: { $avg: '$durationHours' },
                    },
                },
            ]),
            Job.find({ employerId }).select('_id viewCount').lean(),
        ]);

        const acceptanceRate = totalApplicants > 0 ? acceptedCount / totalApplicants : 0;
        const totalViewCount = jobs.reduce((sum, job) => sum + Number(job?.viewCount || 0), 0);
        const jobIds = jobs.map((job) => job._id).filter(Boolean);

        let avgMatchScore = 0;
        if (jobIds.length > 0) {
            const matchAgg = await MatchLog.aggregate([
                { $match: { jobId: { $in: jobIds } } },
                {
                    $group: {
                        _id: null,
                        avgScore: { $avg: '$finalScore' },
                    },
                },
            ]);
            avgMatchScore = Number(matchAgg?.[0]?.avgScore || 0);
        }

        return res.json({
            success: true,
            metrics: {
                totalApplicants: Number(totalApplicants || 0),
                acceptanceRate: Number(acceptanceRate.toFixed(4)),
                avgMatchScore: Number(Math.max(0, Math.min(1, avgMatchScore)).toFixed(4)),
                timeToHireHours: Number(Number(hiredDurationAgg?.[0]?.avgHours || 0).toFixed(2)),
                viewCount: Number(totalViewCount || 0),
            },
        });
    } catch (error) {
        console.warn('Get employer metrics error:', error);
        return res.status(500).json({ message: 'Failed to load employer metrics' });
    }
};

// @desc Register employer webhook endpoint
// @route POST /api/employer/webhooks
// @access Protected (Recruiter)
const registerEmployerWebhookController = async (req, res) => {
    try {
        const payload = req.body || {};
        const result = await registerWebhookSubscription({
            ownerId: req.user._id,
            tenantId: req.user.organizationId || null,
            eventType: payload.eventType,
            targetUrl: payload.targetUrl,
        });

        return res.status(result.created ? 201 : 200).json({
            success: true,
            data: {
                webhookId: result.webhook._id,
                eventType: result.webhook.eventType,
                targetUrl: result.webhook.targetUrl,
                active: result.webhook.active,
                secret: result.secret,
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to register webhook' });
    }
};

// @desc List employer webhooks
// @route GET /api/employer/webhooks
// @access Protected (Recruiter)
const listEmployerWebhooksController = async (req, res) => {
    try {
        const rows = await listWebhookSubscriptions({
            ownerId: req.user._id,
            tenantId: req.user.organizationId || null,
        });

        return res.json({
            success: true,
            data: rows.map((row) => ({
                webhookId: row._id,
                eventType: row.eventType,
                targetUrl: row.targetUrl,
                active: row.active,
                lastDeliveryAt: row.lastDeliveryAt,
                consecutiveFailures: row.consecutiveFailures,
            })),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to list webhooks' });
    }
};

module.exports = {
    getEmployerTierController,
    getEmployerLockInSummaryController,
    getEmployerAnalyticsMetricsController,
    registerEmployerWebhookController,
    listEmployerWebhooksController,
};
