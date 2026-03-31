const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const MatchLog = require('../models/MatchLog');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const { sendSuccess, sendError } = require('../services/externalResponseService');
const {
    parseRequestedFields,
    toPublicId,
    toExternalJobs,
    toExternalApplications,
    toExternalCandidates,
    toExternalMatches,
    resolveExternalPagination,
    buildPaginationMeta,
    pickAllowedFields,
} = require('../services/externalProjectionService');

const normalizeObjectIdString = (value = null) => (value ? String(value) : null);

const requireOwner = (req, res) => {
    const ownerId = normalizeObjectIdString(req.externalApiClient?.ownerId);
    if (!ownerId) {
        sendError(res, {
            status: 403,
            code: 'OWNER_CONTEXT_REQUIRED',
            message: 'External API key is not linked to an owner account',
            requestId: req.correlationId || null,
        });
        return null;
    }
    return ownerId;
};

const getExternalJobs = async (req, res) => {
    try {
        const ownerId = requireOwner(req, res);
        if (!ownerId) return;

        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query);

        const filters = { employerId: ownerId };
        if (req.query.status) {
            filters.status = String(req.query.status).trim();
        }
        if (req.query.isOpen !== undefined) {
            filters.isOpen = String(req.query.isOpen).toLowerCase() === 'true';
        }
        if (req.query.updatedAfter) {
            filters.updatedAt = { $gte: new Date(req.query.updatedAfter) };
        }

        const [jobs, total] = await Promise.all([
            Job.find(filters)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('title companyName location salaryRange status isOpen requirements createdAt updatedAt')
                .lean(),
            Job.countDocuments(filters),
        ]);

        return sendSuccess(res, {
            data: toExternalJobs(jobs, requestedFields),
            meta: {
                pagination: buildPaginationMeta({ total, page, limit }),
            },
            requestId: req.correlationId || null,
        });
    } catch (error) {
        return sendError(res, {
            status: 500,
            code: 'EXTERNAL_JOBS_FETCH_FAILED',
            message: 'Failed to fetch external jobs',
            requestId: req.correlationId || null,
        });
    }
};

const getExternalApplications = async (req, res) => {
    try {
        const ownerId = requireOwner(req, res);
        if (!ownerId) return;

        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query);

        const filters = { employer: ownerId };
        if (req.query.status) {
            filters.status = String(req.query.status).trim();
        }
        if (req.query.updatedAfter) {
            filters.updatedAt = { $gte: new Date(req.query.updatedAfter) };
        }

        const [applications, total] = await Promise.all([
            Application.find(filters)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('job worker status initiatedBy lastMessage createdAt updatedAt')
                .lean(),
            Application.countDocuments(filters),
        ]);

        return sendSuccess(res, {
            data: toExternalApplications(applications, requestedFields),
            meta: {
                pagination: buildPaginationMeta({ total, page, limit }),
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'EXTERNAL_APPLICATIONS_FETCH_FAILED',
            message: 'Failed to fetch external applications',
            requestId: req.correlationId || null,
        });
    }
};

const getExternalCandidates = async (req, res) => {
    try {
        const ownerId = requireOwner(req, res);
        if (!ownerId) return;

        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query);

        const applications = await Application.find({ employer: ownerId })
            .select('worker')
            .lean();

        const workerIds = Array.from(new Set(applications.map((row) => normalizeObjectIdString(row.worker)).filter(Boolean)));

        const filters = workerIds.length ? { _id: { $in: workerIds } } : { _id: { $in: [] } };
        if (req.query.city) {
            filters.city = String(req.query.city).trim();
        }

        const [candidates, total] = await Promise.all([
            WorkerProfile.find(filters)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('firstName city totalExperience preferredShift isAvailable reliabilityScore roleProfiles createdAt updatedAt')
                .lean(),
            WorkerProfile.countDocuments(filters),
        ]);

        return sendSuccess(res, {
            data: toExternalCandidates(candidates, requestedFields),
            meta: {
                pagination: buildPaginationMeta({ total, page, limit }),
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'EXTERNAL_CANDIDATES_FETCH_FAILED',
            message: 'Failed to fetch external candidates',
            requestId: req.correlationId || null,
        });
    }
};

const getExternalMatches = async (req, res) => {
    try {
        const ownerId = requireOwner(req, res);
        if (!ownerId) return;

        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query);

        const jobs = await Job.find({ employerId: ownerId }).select('_id').lean();
        const jobIds = jobs.map((job) => job._id);

        const filters = jobIds.length ? { jobId: { $in: jobIds } } : { jobId: { $in: [] } };

        const [rows, total] = await Promise.all([
            MatchLog.find(filters)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('jobId workerId finalScore tier accepted matchModelVersionUsed createdAt updatedAt')
                .lean(),
            MatchLog.countDocuments(filters),
        ]);

        return sendSuccess(res, {
            data: toExternalMatches(rows, requestedFields),
            meta: {
                pagination: buildPaginationMeta({ total, page, limit }),
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'EXTERNAL_MATCHES_FETCH_FAILED',
            message: 'Failed to fetch external matches',
            requestId: req.correlationId || null,
        });
    }
};

const getExternalAnalytics = async (req, res) => {
    try {
        const ownerId = requireOwner(req, res);
        if (!ownerId) return;

        const dataset = String(req.query.dataset || 'hiring-metrics').trim().toLowerCase();
        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query);

        if (dataset === 'candidate-list') {
            const applications = await Application.find({ employer: ownerId })
                .select('worker')
                .lean();
            const workerIds = Array.from(new Set(applications.map((row) => normalizeObjectIdString(row.worker)).filter(Boolean)));
            const filters = workerIds.length ? { _id: { $in: workerIds } } : { _id: { $in: [] } };

            const [candidates, total] = await Promise.all([
                WorkerProfile.find(filters)
                    .sort({ updatedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .select('firstName city totalExperience preferredShift isAvailable reliabilityScore roleProfiles createdAt updatedAt')
                    .lean(),
                WorkerProfile.countDocuments(filters),
            ]);

            return sendSuccess(res, {
                data: toExternalCandidates(candidates, requestedFields),
                meta: {
                    dataset,
                    pagination: buildPaginationMeta({ total, page, limit }),
                },
                requestId: req.correlationId || null,
            });
        }

        if (dataset === 'job-performance') {
            const [jobs, appAgg] = await Promise.all([
                Job.find({ employerId: ownerId })
                    .sort({ updatedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .select('_id title status isOpen viewCount createdAt updatedAt')
                    .lean(),
                Application.aggregate([
                    { $match: { employer: ownerId } },
                    {
                        $group: {
                            _id: '$job',
                            applications: { $sum: 1 },
                            accepted: {
                                $sum: {
                                    $cond: [{
                                        $in: [
                                            '$status',
                                            ['offer_sent', 'offer_accepted', 'hired', 'accepted', 'offer_proposed'],
                                        ],
                                    }, 1, 0],
                                },
                            },
                        },
                    },
                ]),
            ]);

            const appMap = new Map(appAgg.map((row) => [normalizeObjectIdString(row._id), row]));
            const allowedFields = [
                'jobExternalId',
                'title',
                'status',
                'isOpen',
                'viewCount',
                'applications',
                'accepted',
                'conversionRate',
                'createdAt',
                'updatedAt',
            ];

            const rows = jobs.map((job) => {
                const agg = appMap.get(normalizeObjectIdString(job._id)) || { applications: 0, accepted: 0 };
                const applications = Number(agg.applications || 0);
                const accepted = Number(agg.accepted || 0);
                return pickAllowedFields({
                    jobExternalId: toPublicId('job', job._id),
                    title: job.title,
                    status: job.status,
                    isOpen: Boolean(job.isOpen),
                    viewCount: Number(job.viewCount || 0),
                    applications,
                    accepted,
                    conversionRate: applications > 0 ? Number((accepted / applications).toFixed(4)) : 0,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                }, allowedFields, requestedFields);
            });

            const total = await Job.countDocuments({ employerId: ownerId });

            return sendSuccess(res, {
                data: rows,
                meta: {
                    dataset,
                    pagination: buildPaginationMeta({ total, page, limit }),
                },
                requestId: req.correlationId || null,
            });
        }

        const [applicationAgg, analyticsAgg] = await Promise.all([
            Application.aggregate([
                { $match: { employer: ownerId } },
                {
                    $group: {
                        _id: null,
                        totalApplications: { $sum: 1 },
                        acceptedApplications: {
                            $sum: {
                                $cond: [{
                                    $in: [
                                        '$status',
                                        ['offer_sent', 'offer_accepted', 'hired', 'accepted', 'offer_proposed'],
                                    ],
                                }, 1, 0],
                            },
                        },
                        pendingApplications: {
                            $sum: {
                                $cond: [{ $in: ['$status', ['applied', 'pending', 'requested']] }, 1, 0],
                            },
                        },
                        rejectedApplications: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0],
                            },
                        },
                    },
                },
            ]),
            AnalyticsEvent.aggregate([
                { $match: { user: ownerId } },
                {
                    $group: {
                        _id: '$eventName',
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const row = applicationAgg[0] || {
            totalApplications: 0,
            acceptedApplications: 0,
            pendingApplications: 0,
            rejectedApplications: 0,
        };

        const jobsCount = await Job.countDocuments({ employerId: ownerId });

        return sendSuccess(res, {
            data: {
                jobsCount,
                totalApplications: Number(row.totalApplications || 0),
                acceptedApplications: Number(row.acceptedApplications || 0),
                pendingApplications: Number(row.pendingApplications || 0),
                rejectedApplications: Number(row.rejectedApplications || 0),
                acceptanceRate: Number(row.totalApplications || 0) > 0
                    ? Number((Number(row.acceptedApplications || 0) / Number(row.totalApplications || 0)).toFixed(4))
                    : 0,
                eventBreakdown: analyticsAgg.reduce((acc, item) => {
                    acc[item._id] = Number(item.count || 0);
                    return acc;
                }, {}),
            },
            meta: {
                dataset: 'hiring-metrics',
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'EXTERNAL_ANALYTICS_FETCH_FAILED',
            message: 'Failed to fetch external analytics',
            requestId: req.correlationId || null,
        });
    }
};

module.exports = {
    getExternalJobs,
    getExternalApplications,
    getExternalCandidates,
    getExternalMatches,
    getExternalAnalytics,
};
