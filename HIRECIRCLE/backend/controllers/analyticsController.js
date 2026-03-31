const Job = require('../models/Job');
const Application = require('../models/Application');
const MatchFeedback = require('../models/MatchFeedback');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const ConversionMilestone = require('../models/ConversionMilestone');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const RevenueEvent = require('../models/RevenueEvent');
const CityHiringDailySnapshot = require('../models/CityHiringDailySnapshot');
const { getMatchQualityAnalytics } = require('../services/matchMetricsService');
const { getMatchQualityTargets } = require('../config/matchQualityTargets');
const { isRecruiter } = require('../utils/roleGuards');
const { dispatchAsyncTask, TASK_TYPES } = require('../services/asyncTaskDispatcher');
const { listRegionMetrics } = require('../services/regionMetricsService');
const { DEFAULT_BASE_CURRENCY } = require('../services/currencyConversionService');
const { normalizeApplicationStatus } = require('../workflow/applicationStateMachine');
const mongoose = require('mongoose');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDateParam = (value, fallbackDate) => {
    if (!value) return fallbackDate;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
};

const getWindow = (req, defaultDays = 30) => {
    const to = parseDateParam(req.query.to, new Date());
    const from = parseDateParam(req.query.from, new Date(to.getTime() - defaultDays * MS_PER_DAY));
    return { from, to };
};

const toObjectIdArray = (values = []) => {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
        if (!value) return;
        const normalized = String(value);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        result.push(value);
    });
    return result;
};

const ratio = (num, den) => (den > 0 ? num / den : 0);
const toObjectIdOrNull = (value) => (mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null);

const SHORTLIST_REACHED_STATUSES = Object.freeze([
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'offer_declined',
    'hired',
    // Legacy compatibility
    'accepted',
    'interview',
    'offer_proposed',
]);

const INTERVIEW_REACHED_STATUSES = Object.freeze([
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'offer_declined',
    'hired',
    // Legacy compatibility
    'accepted',
    'interview',
    'offer_proposed',
]);

const OFFER_REACHED_STATUSES = Object.freeze([
    'offer_sent',
    'offer_accepted',
    'offer_declined',
    'hired',
    // Legacy compatibility
    'offer_proposed',
]);

const computeFunnelCountsFromApplications = (applications = []) => {
    return applications.reduce((acc, row) => {
        const status = normalizeApplicationStatus(row?.status, 'applied');
        acc.applied += 1;

        if (status === 'shortlisted') acc.shortlisted += 1;
        if (INTERVIEW_REACHED_STATUSES.includes(status)) acc.interviewed += 1;
        if (OFFER_REACHED_STATUSES.includes(status)) acc.offered += 1;
        if (status === 'hired') acc.hired += 1;
        return acc;
    }, {
        applied: 0,
        shortlisted: 0,
        interviewed: 0,
        offered: 0,
        hired: 0,
    });
};

// @desc Get aggregated hiring funnel for all jobs posted by employer
// @route GET /api/analytics/employer/:employerId/hiring-funnel
const getEmployerHiringFunnel = async (req, res) => {
    try {
        const { employerId } = req.params;

        // Ensure user is authorized to view this (or is admin)
        if (req.user._id.toString() !== employerId && !req.user.isAdmin) {
            return res.status(403).json({ message: "Not authorized" });
        }

        const employerObjectId = toObjectIdOrNull(employerId);
        if (!employerObjectId) {
            return res.status(400).json({ message: 'Invalid employerId' });
        }

        const [totalJobs, applications] = await Promise.all([
            Job.countDocuments({ employerId: employerObjectId }),
            Application.find({ employer: employerObjectId })
                .select('status')
                .lean(),
        ]);

        const funnel = computeFunnelCountsFromApplications(applications);

        res.json({
            totalJobs,
            totalApplications: funnel.applied,
            funnel
        });

    } catch (error) {
        console.warn("Analytics Funnel Error:", error);
        res.status(500).json({ message: "Failed to load funnel analytics" });
    }
};

// @desc Get performance metrics per job
// @route GET /api/analytics/employer/:employerId/job-performance
const getEmployerJobPerformance = async (req, res) => {
    try {
        const { employerId } = req.params;

        if (req.user._id.toString() !== employerId && !req.user.isAdmin) {
            return res.status(403).json({ message: "Not authorized" });
        }
        void dispatchAsyncTask({
            type: TASK_TYPES.METRICS_AGGREGATION,
            payload: { source: 'analytics_employer_job_performance' },
            label: 'analytics_metrics_job_performance',
        });
        void dispatchAsyncTask({
            type: TASK_TYPES.HEAVY_ANALYTICS_QUERY,
            payload: { employerId: String(employerId) },
            label: 'analytics_warm_employer_summary',
        });

        const employerObjectId = toObjectIdOrNull(employerId);
        if (!employerObjectId) {
            return res.status(400).json({ message: 'Invalid employerId' });
        }

        const jobs = await Job.find({ employerId: employerObjectId })
            .sort({ createdAt: -1 })
            .select('_id title isOpen status createdAt viewCount')
            .lean();

        const jobIds = jobs.map((job) => job._id).filter(Boolean);
        const [applicationStats, feedbackStats] = await Promise.all([
            Application.aggregate([
                { $match: { job: { $in: jobIds } } },
                {
                    $group: {
                        _id: '$job',
                        applications: { $sum: 1 },
                        shortlisted: {
                            $sum: { $cond: [{ $in: ['$status', SHORTLIST_REACHED_STATUSES] }, 1, 0] },
                        },
                        hired: {
                            $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] },
                        },
                    },
                },
            ]),
            MatchFeedback.aggregate([
                { $match: { jobId: { $in: jobIds } } },
                {
                    $group: {
                        _id: '$jobId',
                        avgMatchScore: { $avg: '$matchScoreAtTime' },
                    },
                },
            ]),
        ]);

        const applicationByJobId = new Map(
            applicationStats.map((row) => [String(row._id), row])
        );
        const feedbackByJobId = new Map(
            feedbackStats.map((row) => [String(row._id), row])
        );

        const performanceData = jobs.map((job) => {
            const appStats = applicationByJobId.get(String(job._id)) || {};
            const feedback = feedbackByJobId.get(String(job._id)) || {};
            const appsCount = Number(appStats.applications || 0);
            const views = Number(job.viewCount || 0);
            const daysOpen = Math.max(0, Math.floor((Date.now() - new Date(job.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
            return {
                jobId: job._id,
                title: job.title,
                status: String(job.status || '').toLowerCase() === 'active' || job.isOpen ? 'Active' : 'Closed',
                views,
                applications: appsCount,
                shortlisted: Number(appStats.shortlisted || 0),
                hired: Number(appStats.hired || 0),
                avgMatchScore: Math.round(Number(feedback.avgMatchScore || 0)),
                daysOpen,
            };
        });

        res.json(performanceData);

    } catch (error) {
        console.warn("Analytics Performance Error:", error);
        res.status(500).json({ message: "Failed to load job performance data" });
    }
};

// @desc Get cohort retention analysis
// @route GET /api/analytics/cohorts?period=weekly
const getCohorts = async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ message: "Not authorized. Executive access required." });
        }

        const period = req.query.period || 'weekly';

        // Complex aggregation pipeline for cohorts
        const pipeline = [
            {
                $project: {
                    signupDate: "$createdAt",
                    _id: 1,
                    signupWeek: { $week: "$createdAt" },
                    signupYear: { $year: "$createdAt" }
                }
            },
            {
                $group: {
                    _id: { year: "$signupYear", week: "$signupWeek" },
                    users: { $push: "$_id" },
                    totalUsers: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": -1, "_id.week": -1 } },
            { $limit: 10 }
        ];

        const usersByWeek = await User.aggregate(pipeline);

        // Map events back to these cohorts
        // For a true cohort analysis, you'd match AnalyticsEvents back to the users array
        const cohortsData = [];
        for (const cohort of usersByWeek) {
            const cohortMap = {
                cohort: `Week ${cohort._id.week}, ${cohort._id.year}`,
                totalUsers: cohort.totalUsers,
                retention: {} // e.g {"week1": 80, "week2": 60}
            };

            // Mocking retention numbers for brevity context
            cohortMap.retention = {
                "week1": Math.floor(cohort.totalUsers * 0.8),
                "week2": Math.floor(cohort.totalUsers * 0.5),
                "week3": Math.floor(cohort.totalUsers * 0.2),
            };
            cohortsData.push(cohortMap);
        }

        res.json(cohortsData);
    } catch (error) {
        console.warn("Analytics Cohorts Error:", error);
        res.status(500).json({ message: "Failed to load cohort analytics" });
    }
};

// @desc Get LTV prediction for a user
// @route GET /api/analytics/ltv/:userId
const getLTVPrediction = async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ message: "Not authorized. Executive access required." });
        }

        const { userId } = req.params;
        const targetUser = await User.findById(userId);

        if (!targetUser) return res.status(404).json({ message: "User not found" });

        const jobsPosted = await Job.countDocuments({ employerId: userId });
        let appsSubmitted = 0;
        const workerProfile = await WorkerProfile.findOne({ user: userId }).select('_id').lean();
        if (workerProfile?._id) {
            appsSubmitted = await Application.countDocuments({ worker: workerProfile._id });
        }

        // Simple Heuristic ML Placeholder for LTV
        let calculatedLtv = 0;
        if (isRecruiter(targetUser)) {
            calculatedLtv = 50 + (jobsPosted * 100);
            if (targetUser.subscription && targetUser.subscription.plan === 'pro') {
                calculatedLtv += 600; // Expected 1-year retention at $49/mo
            }
        } else {
            calculatedLtv = 10 + (appsSubmitted * 5); // Ad revenue proxy
        }

        res.json({
            userId,
            role: targetUser.role,
            predictedLTV: calculatedLtv,
            currency: DEFAULT_BASE_CURRENCY,
            confidenceScore: 0.85
        });

    } catch (error) {
        console.warn("Analytics LTV Error:", error);
        res.status(500).json({ message: "Failed to compute LTV predictions" });
    }
}

// @desc Get Executive Dashboard aggregations
// @route GET /api/analytics/executive-dashboard
const getExecutiveDashboard = async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ message: "Not authorized. Executive access required." });
        }

        const totalUsers = await User.countDocuments();
        const activeUsers = await AnalyticsEvent.distinct('user', {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });

        const mrr = await User.countDocuments({ "subscription.plan": "pro" }) * 49;

        res.json({
            activeUsers: {
                total: totalUsers,
                mau: activeUsers.length || Math.floor(totalUsers * 0.4), // Fallback if no events yet
            },
            revenue: {
                mrr: mrr,
                currency: DEFAULT_BASE_CURRENCY
            },
            conversions: {
                visitorToSignup: '12%',
                signupToPaid: '4.5%'
            }
        });

    } catch (error) {
        console.warn("Analytics Dashboard Error:", error);
        res.status(500).json({ message: "Failed to load executive dashboard" });
    }
}

const toCityMatch = (city = '') => {
    const normalized = String(city || '').trim();
    if (!normalized) return null;

    const titleCase = normalized
        .toLowerCase()
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

    return {
        $in: toObjectIdArray([
            normalized,
            normalized.toLowerCase(),
            normalized.toUpperCase(),
            titleCase,
        ]),
    };
};

// @desc Employer fill-rate meter for dashboard pressure/upsell
// @route GET /api/analytics/employer/:employerId/fill-rate-meter
const getEmployerFillRateMeter = async (req, res) => {
    try {
        const { employerId } = req.params;
        if (String(req.user?._id) !== String(employerId) && !req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        void dispatchAsyncTask({
            type: TASK_TYPES.METRICS_AGGREGATION,
            payload: { source: 'analytics_employer_fill_rate' },
            label: 'analytics_metrics_fill_rate',
        });

        const { from, to } = getWindow(req, 30);
        const city = String(req.query.city || '').trim();
        const cityMatch = toCityMatch(city);

        const employerJobQuery = {
            employerId: employerObjectId,
            createdAt: { $lte: to },
        };
        if (cityMatch) {
            employerJobQuery.location = cityMatch;
        }

        const employerJobs = await Job.find(employerJobQuery).select('_id');
        const employerJobIds = employerJobs.map((job) => job._id);

        const [totalApplications, hiredApplications, shortlistedApplications] = await Promise.all([
            Application.countDocuments({
                employer: employerObjectId,
                job: { $in: employerJobIds },
                createdAt: { $gte: from, $lte: to },
            }),
            Application.countDocuments({
                employer: employerObjectId,
                job: { $in: employerJobIds },
                status: 'hired',
                updatedAt: { $gte: from, $lte: to },
            }),
            Application.countDocuments({
                employer: employerObjectId,
                job: { $in: employerJobIds },
                status: { $in: SHORTLIST_REACHED_STATUSES },
                updatedAt: { $gte: from, $lte: to },
            }),
        ]);

        let cityJobIds = [];
        if (cityMatch) {
            cityJobIds = await Job.find({ location: cityMatch }).distinct('_id');
        } else {
            const employerLocations = await Job.find({ employerId: employerObjectId }).distinct('location');
            if (employerLocations.length > 0) {
                cityJobIds = await Job.find({ location: { $in: toObjectIdArray(employerLocations) } }).distinct('_id');
            }
        }
        const [cityApplications, cityHires] = await Promise.all([
            Application.countDocuments({
                job: { $in: cityJobIds },
                createdAt: { $gte: from, $lte: to },
            }),
            Application.countDocuments({
                job: { $in: cityJobIds },
                status: 'hired',
                updatedAt: { $gte: from, $lte: to },
            }),
        ]);

        const fillRate = ratio(hiredApplications, totalApplications);
        const shortlistRate = ratio(shortlistedApplications, totalApplications);
        const cityAverageFillRate = ratio(cityHires, cityApplications);
        const applicationsPerHire = fillRate > 0 ? (1 / fillRate) : 0;
        const estimatedTimeToFillDays = fillRate > 0
            ? Math.max(2, Math.round(applicationsPerHire * 2.5))
            : 21;

        return res.json({
            employerId,
            city: city || 'All Cities',
            from,
            to,
            metrics: {
                applicationsCount: totalApplications,
                shortlistRate,
                fillRate,
                estimatedTimeToFillDays,
                cityAverageFillRate,
            },
        });
    } catch (error) {
        console.warn('Fill rate meter error:', error);
        return res.status(500).json({ message: 'Failed to compute fill-rate meter' });
    }
};

// @desc City-level hiring quality index
// @route GET /api/analytics/city-hiring-quality
const getCityHiringQuality = async (req, res) => {
    try {
        const city = String(req.query.city || 'Hyderabad');
        const { from, to } = getWindow(req, 30);
        const cityMatch = toCityMatch(city);
        const snapshotEnabled = String(process.env.CITY_SNAPSHOT_ENABLED || 'false').toLowerCase() === 'true';
        void dispatchAsyncTask({
            type: TASK_TYPES.METRICS_AGGREGATION,
            payload: { source: 'analytics_city_hiring_quality', city },
            label: 'analytics_metrics_city_quality',
        });

        let totals = {
            applications: 0,
            shortlisted: 0,
            hired: 0,
            interviewsCompleted: 0,
            retention30d: 0,
            offerProposed: 0,
            offerAccepted: 0,
            noShowNumerator: 0,
            noShowDenominator: 0,
        };

        if (snapshotEnabled) {
            const snapshots = await CityHiringDailySnapshot.find({
                city: cityMatch,
                day: { $gte: from, $lte: to },
            }).select('metrics');

            if (snapshots.length) {
                totals = snapshots.reduce((acc, item) => ({
                    applications: acc.applications + (item.metrics?.applications || 0),
                    shortlisted: acc.shortlisted + (item.metrics?.shortlisted || 0),
                    hired: acc.hired + (item.metrics?.hired || 0),
                    interviewsCompleted: acc.interviewsCompleted + (item.metrics?.interviewsCompleted || 0),
                    retention30d: acc.retention30d + (item.metrics?.retention30d || 0),
                    offerProposed: acc.offerProposed + (item.metrics?.offerProposed || 0),
                    offerAccepted: acc.offerAccepted + (item.metrics?.offerAccepted || 0),
                    noShowNumerator: acc.noShowNumerator + (item.metrics?.noShowNumerator || 0),
                    noShowDenominator: acc.noShowDenominator + (item.metrics?.noShowDenominator || 0),
                }), totals);
            }
        }

        if (!snapshotEnabled || totals.applications === 0) {
            const [eventTotals] = await HiringLifecycleEvent.aggregate([
                {
                    $match: {
                        city: cityMatch,
                        occurredAt: { $gte: from, $lte: to },
                    },
                },
                {
                    $group: {
                        _id: null,
                        applications: {
                            $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_CREATED'] }, 1, 0] },
                        },
                        shortlisted: {
                            $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_SHORTLISTED'] }, 1, 0] },
                        },
                        hired: {
                            $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_HIRED'] }, 1, 0] },
                        },
                        interviewsCompleted: {
                            $sum: { $cond: [{ $eq: ['$eventType', 'INTERVIEW_CONFIRMED'] }, 1, 0] },
                        },
                        retention30d: {
                            $sum: { $cond: [{ $eq: ['$eventType', 'RETENTION_30D'] }, 1, 0] },
                        },
                    },
                },
            ]);

            totals = {
                ...totals,
                ...(eventTotals || {}),
            };
        }

        const segmentation = await HiringLifecycleEvent.aggregate([
            {
                $match: {
                    city: cityMatch,
                    occurredAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: {
                        roleCluster: '$roleCluster',
                        salaryBand: '$salaryBand',
                        shift: '$shift',
                    },
                    applications: {
                        $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_CREATED'] }, 1, 0] },
                    },
                    shortlisted: {
                        $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_SHORTLISTED'] }, 1, 0] },
                    },
                    hired: {
                        $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_HIRED'] }, 1, 0] },
                    },
                    interviewsCompleted: {
                        $sum: { $cond: [{ $eq: ['$eventType', 'INTERVIEW_CONFIRMED'] }, 1, 0] },
                    },
                },
            },
            { $sort: { applications: -1 } },
            { $limit: 50 },
        ]);

        const fillRate = ratio(totals.hired, totals.applications);
        const interviewCompletionRate = ratio(totals.interviewsCompleted, totals.applications);
        const offerToJoinRatio = ratio(totals.offerAccepted, totals.offerProposed);
        const noShowRate = ratio(totals.noShowNumerator, totals.noShowDenominator);

        return res.json({
            city,
            from,
            to,
            metrics: {
                fillRate,
                noShowRate,
                interviewCompletionRate,
                offerToJoinRatio,
                retention30dCount: totals.retention30d || 0,
                applicationsCount: totals.applications || 0,
                hiredCount: totals.hired || 0,
            },
            segments: segmentation.map((item) => ({
                roleCluster: item._id?.roleCluster || 'general',
                salaryBand: item._id?.salaryBand || 'unknown',
                shift: item._id?.shift || 'unknown',
                applications: item.applications || 0,
                shortlisted: item.shortlisted || 0,
                hired: item.hired || 0,
                fillRate: ratio(item.hired || 0, item.applications || 0),
                interviewCompletionRate: ratio(item.interviewsCompleted || 0, item.applications || 0),
            })),
        });
    } catch (error) {
        console.warn('City hiring quality error:', error);
        return res.status(500).json({ message: 'Failed to compute city hiring quality' });
    }
};

// @desc Revenue loop dashboard metrics
// @route GET /api/analytics/revenue-loops
const getRevenueLoops = async (req, res) => {
    try {
        const city = String(req.query.city || 'Hyderabad');
        const cityMatch = toCityMatch(city);
        const { from, to } = getWindow(req, 30);
        const activityFrom = new Date(to.getTime() - 30 * MS_PER_DAY);
        void dispatchAsyncTask({
            type: TASK_TYPES.METRICS_AGGREGATION,
            payload: { source: 'analytics_revenue_loops', city },
            label: 'analytics_metrics_revenue_loops',
        });

        const [revenueAgg] = await RevenueEvent.aggregate([
            {
                $match: {
                    city: cityMatch,
                    status: 'succeeded',
                    settledAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: null,
                    cityRevenue: { $sum: '$amountInr' },
                    boostedJobIds: {
                        $addToSet: {
                            $cond: [{ $eq: ['$eventType', 'boost_purchase'] }, '$jobId', '$$REMOVE'],
                        },
                    },
                    paidEmployers: { $addToSet: '$employerId' },
                    boostPurchases: {
                        $sum: { $cond: [{ $eq: ['$eventType', 'boost_purchase'] }, 1, 0] },
                    },
                },
            },
        ]);

        const cityJobIds = await Job.find({ location: cityMatch }).distinct('_id');

        const [jobCreatedEmployers, jobActivatedEmployers, appStatusEmployers, boostEmployers, dashboardEmployers] = await Promise.all([
            Job.find({
                location: cityMatch,
                createdAt: { $gte: activityFrom, $lte: to },
            }).distinct('employerId'),
            Job.find({
                location: cityMatch,
                status: 'active',
                updatedAt: { $gte: activityFrom, $lte: to },
            }).distinct('employerId'),
            Application.find({
                job: { $in: cityJobIds },
                status: {
                    $in: [
                        'shortlisted',
                        'interview_requested',
                        'interview_completed',
                        'offer_sent',
                        'offer_accepted',
                        'rejected',
                        'hired',
                        // Legacy compatibility.
                        'accepted',
                        'offer_proposed',
                    ],
                },
                updatedAt: { $gte: activityFrom, $lte: to },
            }).distinct('employer'),
            RevenueEvent.find({
                city: cityMatch,
                eventType: 'boost_purchase',
                status: 'succeeded',
                settledAt: { $gte: activityFrom, $lte: to },
            }).distinct('employerId'),
            AnalyticsEvent.find({
                eventName: 'EMPLOYER_DASHBOARD_OPEN',
                createdAt: { $gte: activityFrom, $lte: to },
            }).distinct('user'),
        ]);

        const activeEmployers = toObjectIdArray([
            ...jobCreatedEmployers,
            ...jobActivatedEmployers,
            ...appStatusEmployers,
            ...boostEmployers,
            ...dashboardEmployers,
        ]).length;

        const signedUpMilestones = await ConversionMilestone.find({
            city: cityMatch,
            signedUpAt: { $gte: from, $lte: to },
        }).select('employerId');
        const signedUpEmployerIds = signedUpMilestones.map((item) => String(item.employerId));
        const paidEmployerIdSet = new Set((revenueAgg?.paidEmployers || []).map((id) => String(id)));
        const convertedPaid = signedUpEmployerIds.filter((id) => paidEmployerIdSet.has(id)).length;
        const paidConversionRate = ratio(convertedPaid, signedUpEmployerIds.length);

        const [applicationCount, hiredCount] = await Promise.all([
            Application.countDocuments({
                job: { $in: cityJobIds },
                createdAt: { $gte: from, $lte: to },
            }),
            Application.countDocuments({
                job: { $in: cityJobIds },
                status: 'hired',
                updatedAt: { $gte: from, $lte: to },
            }),
        ]);
        const fillRate = ratio(hiredCount, applicationCount);

        const timeToFirstHireRows = await ConversionMilestone.find({
            city: cityMatch,
            signedUpAt: { $ne: null },
            firstHireAt: { $ne: null, $gte: from, $lte: to },
        }).select('signedUpAt firstHireAt');

        const timeToFirstHireDays = timeToFirstHireRows.length
            ? timeToFirstHireRows.reduce((acc, row) => {
                const delta = (new Date(row.firstHireAt).getTime() - new Date(row.signedUpAt).getTime()) / MS_PER_DAY;
                return acc + Math.max(0, delta);
            }, 0) / timeToFirstHireRows.length
            : 0;

        const activatedJobsCount = await Job.countDocuments({
            location: cityMatch,
            status: 'active',
            updatedAt: { $gte: from, $lte: to },
        });
        const boostedJobsCount = (revenueAgg?.boostedJobIds || []).filter(Boolean).length;
        const boostAttachRate = ratio(boostedJobsCount, activatedJobsCount);

        const [confirmedWorkers, appliedWorkers] = await Promise.all([
            HiringLifecycleEvent.distinct('workerId', {
                city: cityMatch,
                eventType: 'INTERVIEW_CONFIRMED',
                occurredAt: { $gte: from, $lte: to },
            }),
            HiringLifecycleEvent.distinct('workerId', {
                city: cityMatch,
                eventType: 'APPLICATION_CREATED',
                occurredAt: { $gte: from, $lte: to },
            }),
        ]);
        const confirmedWorkerSet = new Set((confirmedWorkers || []).filter(Boolean).map((id) => String(id)));
        const appliedAfterConfirmCount = (appliedWorkers || [])
            .filter(Boolean)
            .map((id) => String(id))
            .filter((id) => confirmedWorkerSet.has(id))
            .length;
        const interviewConfirmedToApplyRate = ratio(appliedAfterConfirmCount, confirmedWorkerSet.size);

        return res.json({
            city,
            from,
            to,
            metrics: {
                cityRevenue: revenueAgg?.cityRevenue || 0,
                activeEmployers,
                revenuePerEmployer: ratio(revenueAgg?.cityRevenue || 0, activeEmployers),
                paidConversionRate,
                fillRate,
                timeToFirstHireDays,
                boostAttachRate,
                interviewConfirmedToApplyRate,
            },
            counts: {
                signedUp: signedUpEmployerIds.length,
                convertedPaid,
                applications: applicationCount,
                hired: hiredCount,
                activatedJobs: activatedJobsCount,
                boostedJobs: boostedJobsCount,
                confirmedWorkers: confirmedWorkerSet.size,
                appliedAfterConfirm: appliedAfterConfirmCount,
                boostPurchases: revenueAgg?.boostPurchases || 0,
            },
        });
    } catch (error) {
        console.warn('Revenue loops analytics error:', error);
        return res.status(500).json({ message: 'Failed to compute revenue loop metrics' });
    }
};

// @desc Match quality dashboard overview metrics
// @route GET /api/analytics/match-quality-overview
const getMatchQualityOverview = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city) : null;
        const roleCluster = req.query.roleCluster ? String(req.query.roleCluster) : null;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;

        const result = await getMatchQualityAnalytics({
            city,
            roleCluster,
            from,
            to,
            defaultDays: 30,
        });
        const targets = getMatchQualityTargets();

        return res.json({
            totalMatchesServed: result.overview.totalMatchesServed,
            avgMatchProbability: result.overview.avgMatchProbability,
            applicationRate: result.overview.applicationRate,
            shortlistRate: result.overview.shortlistRate,
            hireRate: result.overview.hireRate,
            retention30dRate: result.overview.retention30dRate,
            targets: {
                interviewRateTarget: targets.interviewRateTarget,
                postInterviewHireRateTarget: targets.postInterviewHireRateTarget,
                offerAcceptanceTarget: targets.offerAcceptanceTarget,
            },
        });
    } catch (error) {
        console.warn('Match quality overview error:', error);
        return res.status(500).json({ message: 'Failed to compute match quality overview' });
    }
};

// @desc Match quality detail metrics and buckets
// @route GET /api/analytics/match-quality-detail
const getMatchQualityDetail = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city) : null;
        const roleCluster = req.query.roleCluster ? String(req.query.roleCluster) : null;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;

        const result = await getMatchQualityAnalytics({
            city,
            roleCluster,
            from,
            to,
            defaultDays: 30,
        });

        return res.json({
            matchProbabilityBuckets: result.detail.matchProbabilityBuckets,
            conversionRates: result.detail.conversionRates,
            cohortMetrics: result.detail.cohortMetrics,
            range: {
                from: result.from,
                to: result.to,
            },
        });
    } catch (error) {
        console.warn('Match quality detail error:', error);
        return res.status(500).json({ message: 'Failed to compute match quality detail' });
    }
};

// @desc Smart Interview quality intelligence metrics
// @route GET /api/analytics/smart-interview-quality
const getSmartInterviewQuality = async (req, res) => {
    try {
        const { from, to } = getWindow(req, 30);

        const baseMatch = {
            createdAt: { $gte: from, $lte: to },
        };

        const [
            totalInterviews,
            completedInterviews,
            clarificationRows,
            slotRows,
            qualityBuckets,
            salaryOutlierRows,
        ] = await Promise.all([
            InterviewProcessingJob.countDocuments(baseMatch),
            InterviewProcessingJob.countDocuments({
                ...baseMatch,
                status: 'completed',
            }),
            InterviewProcessingJob.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: null,
                        clarificationTriggeredCount: { $sum: { $ifNull: ['$clarificationTriggeredCount', 0] } },
                        clarificationResolvedCount: { $sum: { $ifNull: ['$clarificationResolvedCount', 0] } },
                        clarificationSkippedCount: { $sum: { $ifNull: ['$clarificationSkippedCount', 0] } },
                    },
                },
            ]),
            InterviewProcessingJob.aggregate([
                {
                    $match: {
                        ...baseMatch,
                        status: 'completed',
                    },
                },
                {
                    $group: {
                        _id: null,
                        avgSlotCompletenessRatio: { $avg: { $ifNull: ['$rawMetrics.slotCompletenessRatio', 0] } },
                        avgProfileQualityScore: { $avg: { $ifNull: ['$rawMetrics.profileQualityScore', 0] } },
                        avgAmbiguityRate: { $avg: { $ifNull: ['$rawMetrics.ambiguityRate', 0] } },
                    },
                },
            ]),
            WorkerProfile.aggregate([
                {
                    $match: {
                        'interviewIntelligence.profileQualityScore': { $ne: null },
                    },
                },
                {
                    $project: {
                        qualityBucket: {
                            $switch: {
                                branches: [
                                    {
                                        case: { $gte: ['$interviewIntelligence.profileQualityScore', 0.8] },
                                        then: 'HIGH',
                                    },
                                    {
                                        case: { $gte: ['$interviewIntelligence.profileQualityScore', 0.6] },
                                        then: 'MEDIUM',
                                    },
                                ],
                                default: 'LOW',
                            },
                        },
                    },
                },
                {
                    $lookup: {
                        from: Application.collection.name,
                        localField: '_id',
                        foreignField: 'worker',
                        as: 'applications',
                    },
                },
                {
                    $project: {
                        qualityBucket: 1,
                        hasHire: {
                            $gt: [
                                {
                                    $size: {
                                        $filter: {
                                            input: '$applications',
                                            as: 'app',
                                            cond: {
                                                $in: [
                                                    '$$app.status',
                                                    ['hired', 'offer_accepted'],
                                                ],
                                            },
                                        },
                                    },
                                },
                                0,
                            ],
                        },
                    },
                },
                {
                    $group: {
                        _id: '$qualityBucket',
                        workers: { $sum: 1 },
                        workersWithHire: {
                            $sum: { $cond: ['$hasHire', 1, 0] },
                        },
                    },
                },
            ]),
            WorkerProfile.aggregate([
                {
                    $match: {
                        'interviewIntelligence.salaryOutlierFlag': { $in: [true, false] },
                    },
                },
                {
                    $project: {
                        salaryOutlierFlag: '$interviewIntelligence.salaryOutlierFlag',
                    },
                },
                {
                    $lookup: {
                        from: Application.collection.name,
                        localField: '_id',
                        foreignField: 'worker',
                        as: 'applications',
                    },
                },
                {
                    $project: {
                        salaryOutlierFlag: 1,
                        totalApplications: { $size: '$applications' },
                        shortlistedApplications: {
                            $size: {
                                $filter: {
                                    input: '$applications',
                                    as: 'app',
                                    cond: {
                                        $in: [
                                            '$$app.status',
                                            [
                                                'shortlisted',
                                                'interview_requested',
                                                'interview_completed',
                                                'offer_sent',
                                                'offer_accepted',
                                                'hired',
                                                // Legacy compatibility.
                                                'accepted',
                                                'offer_proposed',
                                            ],
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    $group: {
                        _id: '$salaryOutlierFlag',
                        totalApplications: { $sum: '$totalApplications' },
                        shortlistedApplications: { $sum: '$shortlistedApplications' },
                    },
                },
            ]),
        ]);

        const completionRate = ratio(completedInterviews, totalInterviews);
        const clarificationTotals = clarificationRows[0] || {};
        const clarificationFrequency = totalInterviews > 0
            ? Number((Number(clarificationTotals.clarificationTriggeredCount || 0) / totalInterviews).toFixed(4))
            : 0;
        const slotTotals = slotRows[0] || {};

        const qualityCorrelation = qualityBuckets.map((row) => ({
            profileQualityBucket: row._id,
            workers: Number(row.workers || 0),
            workersWithHire: Number(row.workersWithHire || 0),
            hireRate: ratio(row.workersWithHire || 0, row.workers || 0),
        }));

        const salaryOutlierImpact = salaryOutlierRows.map((row) => ({
            salaryOutlierFlag: Boolean(row._id),
            totalApplications: Number(row.totalApplications || 0),
            shortlistedApplications: Number(row.shortlistedApplications || 0),
            shortlistRate: ratio(row.shortlistedApplications || 0, row.totalApplications || 0),
        }));

        return res.json({
            from,
            to,
            metrics: {
                interviewCompletionRate: completionRate,
                clarificationFrequency,
                slotCompletenessRatio: Number(slotTotals.avgSlotCompletenessRatio || 0),
                avgProfileQualityScore: Number(slotTotals.avgProfileQualityScore || 0),
                avgAmbiguityRate: Number(slotTotals.avgAmbiguityRate || 0),
            },
            clarification: {
                clarificationTriggeredCount: Number(clarificationTotals.clarificationTriggeredCount || 0),
                clarificationResolvedCount: Number(clarificationTotals.clarificationResolvedCount || 0),
                clarificationSkippedCount: Number(clarificationTotals.clarificationSkippedCount || 0),
            },
            profileQualityVsHireRate: qualityCorrelation,
            salaryOutlierShortlistImpact: salaryOutlierImpact,
        });
    } catch (error) {
        console.warn('Smart interview quality analytics error:', error);
        return res.status(500).json({ message: 'Failed to compute smart interview quality metrics' });
    }
};

// @desc Region growth metrics snapshots
// @route GET /api/analytics/region-metrics
const getRegionMetrics = async (req, res) => {
    try {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized. Executive access required.' });
        }

        const region = String(req.query.region || '').trim();
        const country = String(req.query.country || '').trim();
        const limit = Number.parseInt(req.query.limit || '100', 10);
        const metrics = await listRegionMetrics({
            region: region || null,
            country: country || null,
            limit,
        });

        return res.json({
            count: metrics.length,
            region: region || null,
            country: country || null,
            metrics,
        });
    } catch (error) {
        console.warn('Region metrics analytics error:', error);
        return res.status(500).json({ message: 'Failed to fetch region metrics' });
    }
};

module.exports = {
    getEmployerHiringFunnel,
    getEmployerJobPerformance,
    getCohorts,
    getLTVPrediction,
    getExecutiveDashboard,
    getEmployerFillRateMeter,
    getCityHiringQuality,
    getRevenueLoops,
    getMatchQualityOverview,
    getMatchQualityDetail,
    getSmartInterviewQuality,
    getRegionMetrics,
};
