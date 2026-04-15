const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const BetaCode = require('../models/BetaCode');
const CityEmployerPipeline = require('../models/CityEmployerPipeline');
const EmployerTier = require('../models/EmployerTier');
const MatchModelReport = require('../models/MatchModelReport');
const RevenueEvent = require('../models/RevenueEvent');
const Report = require('../models/Report');
const DailyMetrics = require('../models/DailyMetrics');
const Message = require('../models/Message');
const FeatureFlag = require('../models/FeatureFlag');
const UserTrustScore = require('../models/UserTrustScore');
const Post = require('../models/Post');
const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const { getAndPersistCalibrationSuggestion } = require('../match/matchModelCalibration');
const { getMatchPerformanceAlerts } = require('../services/matchMetricsService');
const { getLatestCityLiquidity } = require('../services/cityLiquidityService');
const { getLatestCityExpansionSignals } = require('../services/cityExpansionSignalService');
const { getMarketAlerts } = require('../services/marketAnomalyService');
const { getMarketInsights } = require('../services/marketInsightsService');
const { getCompetitiveThreatSignals } = require('../services/competitiveThreatService');
const HiringTrajectoryModel = require('../models/HiringTrajectoryModel');
const { CANDIDATE_ROLE, recruiterRoleQuery } = require('../utils/roleGuards');
const { getMonitoringSnapshot } = require('../services/systemMonitoringService');
const { setFeatureFlag, listFeatureFlags } = require('../services/featureFlagService');

// @desc Get high-level platform statistics
// @route GET /api/admin/stats
const getPlatformStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalEmployers = await User.countDocuments({ role: recruiterRoleQuery() });
        const totalCandidates = await User.countDocuments({ role: CANDIDATE_ROLE });
        const totalJobs = await Job.countDocuments();
        const activeJobs = await Job.countDocuments({ isOpen: true });
        const totalApplications = await Application.countDocuments();
        const pendingReports = await Report.countDocuments({ status: 'pending' });

        // Calculate a lightweight engagement proxy based on applications per job.
        const engagementScore = (totalApplications / (totalJobs || 1)).toFixed(1);

        res.json({
            users: { total: totalUsers, employers: totalEmployers, candidates: totalCandidates },
            jobs: { total: totalJobs, active: activeJobs },
            activity: { totalApplications, avgAppsPerJob: engagementScore },
            reports: { pending: pendingReports },
        });
    } catch (error) {
        console.warn("Admin Stats Error:", error);
        res.status(500).json({ message: "Failed to load platform stats" });
    }
};

// @desc Get all users with pagination for admin table
// @route GET /api/admin/users
const getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const startIndex = (page - 1) * limit;

        const users = await User.find()
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit);

        const total = await User.countDocuments();

        res.json({
            users,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.warn("Admin Users Error:", error);
        res.status(500).json({ message: "Failed to load users" });
    }
};

// @desc Get all jobs with pagination for admin table
// @route GET /api/admin/jobs
const getAllJobs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const startIndex = (page - 1) * limit;

        const jobs = await Job.find().populate('employerId', 'name email companyName')
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit);

        const total = await Job.countDocuments();

        res.json({
            jobs,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.warn("Admin Jobs Error:", error);
        res.status(500).json({ message: "Failed to load jobs" });
    }
};

// @desc Get moderation reports
// @route GET /api/admin/reports
const getAllReports = async (req, res) => {
    try {
        const page = Number.parseInt(req.query.page || '1', 10);
        const limit = Number.parseInt(req.query.limit || '20', 10);
        const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
        const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);

        const query = {};
        if (status) {
            query.status = status;
        }

        const [reports, total] = await Promise.all([
            Report.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('reporterId', 'name email')
                .lean(),
            Report.countDocuments(query),
        ]);

        return res.json({
            success: true,
            reports: reports.map((report) => ({
                ...report,
                reporterName: report.reporterId?.name || 'Unknown Reporter',
                reporterEmail: report.reporterId?.email || null,
            })),
            total,
            page: Math.max(page, 1),
            pages: Math.ceil(total / Math.max(limit, 1)),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load reports' });
    }
};

// @desc Dismiss moderation report
// @route PATCH /api/admin/reports/:id/dismiss
const dismissReport = async (req, res) => {
    try {
        const report = await Report.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    status: 'dismissed',
                    reviewedBy: req.admin?._id || null,
                    reviewedAt: new Date(),
                    resolutionNotes: String(req.body?.resolutionNotes || '').trim(),
                },
            },
            { new: true }
        );

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        return res.json({ success: true, report });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to dismiss report' });
    }
};

const removeReportedTarget = async (report) => {
    const targetId = String(report.targetId || '');
    if (!targetId) return;

    if (report.targetType === 'job') {
        await Job.findByIdAndUpdate(targetId, {
            $set: {
                isDisabled: true,
                disabledAt: new Date(),
                disabledReason: 'Removed by moderation',
                isOpen: false,
                status: 'closed',
            },
        });
        return;
    }

    if (report.targetType === 'user') {
        await User.findByIdAndUpdate(targetId, {
            $set: {
                isBanned: true,
                banReason: 'Banned by moderation',
                bannedAt: new Date(),
                isFlagged: true,
                trustStatus: 'restricted',
            },
            $inc: { tokenVersion: 1 },
        });
        return;
    }

    if (report.targetType === 'message') {
        await Message.findByIdAndDelete(targetId);
        return;
    }

    if (report.targetType === 'post' || report.targetType === 'bounty') {
        await Post.findByIdAndDelete(targetId);
        return;
    }

    if (report.targetType === 'circle_post') {
        await CirclePost.findByIdAndDelete(targetId);
        return;
    }

    if (report.targetType === 'circle') {
        await Circle.findByIdAndDelete(targetId);
        return;
    }

    if (report.targetType === 'application') {
        await Application.findByIdAndDelete(targetId);
    }
};

// @desc Review and action moderation report
// @route PATCH /api/admin/reports/:id
const reviewReport = async (req, res) => {
    try {
        const action = String(req.body?.action || '').trim().toLowerCase();
        if (!['approve', 'remove', 'dismiss'].includes(action)) {
            return res.status(400).json({ message: 'action must be approve, remove, or dismiss' });
        }

        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        if (action === 'remove') {
            await removeReportedTarget(report);
        }

        report.status = action === 'dismiss' ? 'dismissed' : (action === 'remove' ? 'removed' : 'approved');
        report.reviewedBy = req.admin?._id || null;
        report.reviewedAt = new Date();
        report.resolutionNotes = String(req.body?.resolutionNotes || '').trim();
        await report.save();

        return res.json({ success: true, report });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to review report' });
    }
};

// @desc Get platform intelligence metrics
// @route GET /api/admin/metrics
const getPlatformMetrics = async (req, res) => {
    try {
        const [latestDailyMetrics, pendingReports, flaggedUsers, monitoring, featureFlags] = await Promise.all([
            DailyMetrics.findOne({}).sort({ day: -1 }).lean(),
            Report.countDocuments({ status: 'pending' }),
            UserTrustScore.countDocuments({ isFlagged: true }),
            getMonitoringSnapshot(),
            listFeatureFlags(),
        ]);

        return res.json({
            success: true,
            metrics: {
                daily: latestDailyMetrics,
                moderation: {
                    pendingReports,
                    flaggedUsers,
                },
                monitoring,
                featureFlags,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load metrics' });
    }
};

// @desc Ban or unban user
// @route PATCH /api/admin/ban-user
const banUser = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        const ban = typeof req.body?.ban === 'boolean' ? req.body.ban : true;
        const reason = String(req.body?.reason || (ban ? 'Banned by admin' : '')).trim();

        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    isBanned: ban,
                    banReason: ban ? reason : null,
                    bannedAt: ban ? new Date() : null,
                    isFlagged: ban ? true : Boolean(req.body?.isFlagged),
                    trustStatus: ban ? 'restricted' : 'healthy',
                },
                $inc: { tokenVersion: 1 },
            },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await UserTrustScore.findOneAndUpdate(
            { userId },
            {
                $set: {
                    score: ban ? 0 : 100,
                    status: ban ? 'restricted' : 'healthy',
                    isFlagged: Boolean(ban),
                    reasons: ban ? [`admin_ban:${reason || 'policy'}`] : [],
                    lastEvaluatedAt: new Date(),
                },
            },
            { upsert: true }
        );

        return res.json({
            success: true,
            user,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update user ban state' });
    }
};

// @desc Disable or enable job
// @route PATCH /api/admin/disable-job
const disableJob = async (req, res) => {
    try {
        const jobId = String(req.body?.jobId || '').trim();
        const disable = typeof req.body?.disable === 'boolean' ? req.body.disable : true;
        const reason = String(req.body?.reason || (disable ? 'Disabled by admin' : '')).trim();

        if (!jobId) {
            return res.status(400).json({ message: 'jobId is required' });
        }

        const update = disable
            ? {
                isDisabled: true,
                disabledAt: new Date(),
                disabledReason: reason,
                isOpen: false,
                status: 'closed',
            }
            : {
                isDisabled: false,
                disabledAt: null,
                disabledReason: null,
                isOpen: true,
                status: 'active',
            };

        const job = await Job.findByIdAndUpdate(jobId, { $set: update }, { new: true });
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        return res.json({
            success: true,
            job,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update job state' });
    }
};

// @desc Toggle feature flags dynamically
// @route PATCH /api/admin/feature-toggle
const updateFeatureToggle = async (req, res) => {
    try {
        const key = String(req.body?.key || '').trim().toUpperCase();
        const enabledInput = req.body?.enabled;
        const description = String(req.body?.description || '').trim();

        if (!key) {
            return res.status(400).json({ message: 'key is required' });
        }
        if (typeof enabledInput !== 'boolean') {
            return res.status(400).json({ message: 'enabled must be boolean' });
        }

        const flag = await setFeatureFlag({
            key,
            enabled: enabledInput,
            description,
            updatedByAdmin: req.admin?._id || null,
            metadata: {
                source: 'admin_controller',
            },
        });

        return res.json({
            success: true,
            featureFlag: flag,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update feature flag' });
    }
};

// @desc Generate new beta codes for user distribution
// @route POST /api/admin/beta-codes
const generateBetaCodes = async (req, res) => {
    try {
        const { count = 5 } = req.body;
        const crypto = require('crypto');

        const newCodes = [];
        for (let i = 0; i < count; i++) {
            // Generate a readable 8-10 char code e.g. BETA-A1B2C3D4
            const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
            newCodes.push({ code: `BETA-${randomString}` });
        }

        const insertedCodes = await BetaCode.insertMany(newCodes);

        res.status(201).json({
            success: true,
            message: `Generated ${count} new beta codes`,
            codes: insertedCodes.map(c => c.code)
        });
    } catch (error) {
        console.warn("Generate Beta Codes Error:", error);
        res.status(500).json({ message: "Failed to generate beta codes" });
    }
};

// @desc Create city employer pipeline lead
// @route POST /api/admin/city-pipeline
const createCityPipelineEntry = async (req, res) => {
    try {
        const {
            city = 'Hyderabad',
            companyName,
            contactName = '',
            phone = '',
            stage = 'lead',
            source = 'unknown',
            owner = '',
            notes = '',
        } = req.body || {};

        if (!companyName) {
            return res.status(400).json({ message: 'companyName is required' });
        }

        const entry = await CityEmployerPipeline.create({
            city,
            companyName,
            contactName,
            phone,
            stage,
            source,
            owner,
            notes,
        });

        return res.status(201).json({ success: true, data: entry });
    } catch (error) {
        console.warn('Create city pipeline entry error:', error);
        return res.status(500).json({ message: 'Failed to create pipeline entry' });
    }
};

// @desc List city employer pipeline entries
// @route GET /api/admin/city-pipeline
const getCityPipelineEntries = async (req, res) => {
    try {
        const city = String(req.query.city || 'Hyderabad');
        const stage = req.query.stage ? String(req.query.stage) : null;
        const page = Number.parseInt(req.query.page || '1', 10);
        const limit = Number.parseInt(req.query.limit || '50', 10);
        const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);

        const query = { city };
        if (stage) query.stage = stage;

        const [rows, total] = await Promise.all([
            CityEmployerPipeline.find(query)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit),
            CityEmployerPipeline.countDocuments(query),
        ]);

        return res.json({
            success: true,
            data: rows,
            page: Math.max(page, 1),
            pages: Math.ceil(total / Math.max(limit, 1)),
            total,
        });
    } catch (error) {
        console.warn('Get city pipeline entries error:', error);
        return res.status(500).json({ message: 'Failed to load city pipeline entries' });
    }
};

// @desc Update city employer pipeline entry
// @route PUT /api/admin/city-pipeline/:id
const updateCityPipelineEntry = async (req, res) => {
    try {
        const existing = await CityEmployerPipeline.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Pipeline entry not found' });
        }

        const payload = { ...req.body };
        const now = new Date();
        const nextStage = payload.stage ? String(payload.stage) : existing.stage;
        if (nextStage === 'trial_started' && !existing.trialStartedAt) payload.trialStartedAt = now;
        if (nextStage === 'converted_paid' && !existing.convertedPaidAt) payload.convertedPaidAt = now;
        if (nextStage === 'repeat_hiring' && !existing.repeatHiringAt) payload.repeatHiringAt = now;

        const updated = await CityEmployerPipeline.findByIdAndUpdate(
            req.params.id,
            { $set: payload },
            { new: true }
        );

        return res.json({ success: true, data: updated });
    } catch (error) {
        console.warn('Update city pipeline entry error:', error);
        return res.status(500).json({ message: 'Failed to update city pipeline entry' });
    }
};

// @desc Get city employer pipeline summary
// @route GET /api/admin/city-pipeline/summary
const getCityPipelineSummary = async (req, res) => {
    try {
        const city = String(req.query.city || 'Hyderabad');

        const [summaryRows] = await Promise.all([
            CityEmployerPipeline.aggregate([
                { $match: { city } },
                {
                    $group: {
                        _id: '$stage',
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const stageMap = summaryRows.reduce((acc, row) => ({
            ...acc,
            [row._id]: row.count,
        }), {});

        return res.json({
            success: true,
            city,
            summary: {
                lead: stageMap.lead || 0,
                demo_done: stageMap.demo_done || 0,
                trial_started: stageMap.trial_started || 0,
                converted_paid: stageMap.converted_paid || 0,
                repeat_hiring: stageMap.repeat_hiring || 0,
                lost: stageMap.lost || 0,
            },
        });
    } catch (error) {
        console.warn('City pipeline summary error:', error);
        return res.status(500).json({ message: 'Failed to load city pipeline summary' });
    }
};

// @desc Get match model training report
// @route GET /api/admin/match-report?modelVersion=
const getMatchReport = async (req, res) => {
    try {
        const requestedVersion = String(req.query.modelVersion || '').trim();

        const query = requestedVersion ? { modelVersion: requestedVersion } : {};
        const report = await MatchModelReport.findOne(query).sort({ createdAt: -1 }).lean();

        if (!report) {
            return res.status(404).json({ message: 'Match model report not found' });
        }

        return res.json({
            success: true,
            data: report,
        });
    } catch (error) {
        console.warn('Get match model report error:', error);
        return res.status(500).json({ message: 'Failed to load match model report' });
    }
};

// @desc Get match calibration suggestions and persist suggestion snapshot
// @route GET /api/admin/match-calibration-suggestions
const getMatchCalibrationSuggestions = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const roleCluster = req.query.roleCluster ? String(req.query.roleCluster).trim() : null;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;

        const { suggestion, persisted } = await getAndPersistCalibrationSuggestion({
            city,
            roleCluster,
            from,
            to,
        });

        return res.json({
            success: true,
            data: {
                ...suggestion,
                calibrationId: persisted?._id || null,
            },
        });
    } catch (error) {
        console.warn('Get match calibration suggestions error:', error);
        return res.status(500).json({ message: 'Failed to generate calibration suggestions' });
    }
};

// @desc Get match performance alerts against benchmark targets
// @route GET /api/admin/match-performance-alerts
const getMatchPerformanceAlertsController = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const roleCluster = req.query.roleCluster ? String(req.query.roleCluster).trim() : null;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;

        const result = await getMatchPerformanceAlerts({
            city,
            roleCluster,
            from,
            to,
        });

        return res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.warn('Get match performance alerts error:', error);
        return res.status(500).json({ message: 'Failed to load match performance alerts' });
    }
};

// @desc Get latest city liquidity metrics
// @route GET /api/admin/city-liquidity
const getCityLiquidity = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const limit = Number.parseInt(req.query.limit || '100', 10);
        const rows = await getLatestCityLiquidity({ city, limit });

        return res.json({
            success: true,
            data: rows,
            summary: {
                underSuppliedCities: rows.filter((row) => row.marketBand === 'under_supplied').length,
                overSuppliedCities: rows.filter((row) => row.marketBand === 'over_supplied').length,
            },
        });
    } catch (error) {
        console.warn('Get city liquidity error:', error);
        return res.status(500).json({ message: 'Failed to load city liquidity' });
    }
};

// @desc Get city expansion readiness signals
// @route GET /api/admin/city-expansion-signals
const getCityExpansionSignalsController = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const limit = Number.parseInt(req.query.limit || '100', 10);
        const rows = await getLatestCityExpansionSignals({ city, limit });

        return res.json({
            success: true,
            data: rows,
            summary: {
                readyForScaleCities: rows.filter((row) => row.readinessStatus === 'READY_FOR_SCALE').length,
                watchlistCities: rows.filter((row) => row.readinessStatus === 'WATCHLIST').length,
            },
        });
    } catch (error) {
        console.warn('Get city expansion signals error:', error);
        return res.status(500).json({ message: 'Failed to load city expansion signals' });
    }
};

// @desc Get market anomaly alerts
// @route GET /api/admin/market-alerts
const getMarketAlertsController = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const limit = Number.parseInt(req.query.limit || '100', 10);
        const rows = await getMarketAlerts({ city, limit });

        return res.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.warn('Get market alerts error:', error);
        return res.status(500).json({ message: 'Failed to load market alerts' });
    }
};

// @desc Market control dashboard overview
// @route GET /api/admin/market-control
const getMarketControlOverview = async (req, res) => {
    try {
        const now = new Date();
        const from30d = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

        const [cityLiquidityRows, cityExpansionRows, tierRows, revenueRows] = await Promise.all([
            getLatestCityLiquidity({ limit: 200 }),
            getLatestCityExpansionSignals({ limit: 200 }),
            EmployerTier.aggregate([
                {
                    $group: {
                        _id: '$tier',
                        count: { $sum: 1 },
                    },
                },
            ]),
            RevenueEvent.aggregate([
                {
                    $match: {
                        status: 'succeeded',
                        settledAt: { $gte: from30d, $lte: now },
                    },
                },
                {
                    $group: {
                        _id: '$city',
                        revenueInr: { $sum: '$amountInr' },
                    },
                },
                { $sort: { revenueInr: -1 } },
            ]),
        ]);

        const totalTieredEmployers = tierRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
        const tierDistribution = tierRows.map((row) => ({
            tier: row._id || 'Unknown',
            count: Number(row.count || 0),
            share: totalTieredEmployers > 0 ? Number((Number(row.count || 0) / totalTieredEmployers).toFixed(4)) : 0,
        }));

        const fillRatePerCity = cityLiquidityRows.map((row) => ({
            city: row.city,
            fillRate: Number(row.fillRate || 0),
            workersPerJob: Number(row.workersPerJob || 0),
            marketBand: row.marketBand,
        }));

        const expansionByCity = cityExpansionRows.map((row) => ({
            city: row.city,
            expansionReadinessScore: Number(row.expansionReadinessScore || 0),
            readinessStatus: row.readinessStatus,
        }));

        return res.json({
            success: true,
            data: {
                generatedAt: now.toISOString(),
                cityLiquidity: cityLiquidityRows,
                fillRatePerCity,
                tierDistribution,
                employerTierShare: tierDistribution,
                revenuePerCity: revenueRows.map((row) => ({
                    city: row._id || 'unknown',
                    revenueInr: Number(row.revenueInr || 0),
                })),
                expansionReadiness: expansionByCity,
            },
        });
    } catch (error) {
        console.warn('Get market control overview error:', error);
        return res.status(500).json({ message: 'Failed to load market control overview' });
    }
};

// @desc Get internal market insights data product payload
// @route GET /api/admin/market-insights
const getMarketInsightsController = async (req, res) => {
    try {
        const data = await getMarketInsights({ day: new Date() });
        return res.json({
            success: true,
            data,
        });
    } catch (error) {
        console.warn('Get market insights error:', error);
        return res.status(500).json({ message: 'Failed to load market insights' });
    }
};

// @desc Get strategic competitive threat signals
// @route GET /api/admin/competitive-threat-signals
const getCompetitiveThreatSignalsController = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const status = req.query.status ? String(req.query.status).trim() : null;
        const limit = Number.parseInt(req.query.limit || '100', 10);
        const rows = await getCompetitiveThreatSignals({ city, status, limit });
        return res.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.warn('Get competitive threat signals error:', error);
        return res.status(500).json({ message: 'Failed to load competitive threat signals' });
    }
};

// @desc Get hiring trajectory model outputs
// @route GET /api/admin/hiring-trajectories
const getHiringTrajectoryController = async (req, res) => {
    try {
        const entityType = req.query.entityType ? String(req.query.entityType).trim() : null;
        const city = req.query.city ? String(req.query.city).trim() : null;
        const limit = Number.parseInt(req.query.limit || '100', 10);

        const rows = await HiringTrajectoryModel.find({
            ...(entityType ? { entityType } : {}),
            ...(city ? { city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : {}),
        })
            .sort({ trajectoryScore: -1, computedAt: -1 })
            .limit(limit)
            .lean();

        return res.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.warn('Get hiring trajectories error:', error);
        return res.status(500).json({ message: 'Failed to load hiring trajectories' });
    }
};

module.exports = {
    getPlatformStats,
    getAllUsers,
    getAllJobs,
    getAllReports,
    reviewReport,
    dismissReport,
    getPlatformMetrics,
    banUser,
    disableJob,
    updateFeatureToggle,
    generateBetaCodes,
    createCityPipelineEntry,
    getCityPipelineEntries,
    updateCityPipelineEntry,
    getCityPipelineSummary,
    getMatchReport,
    getMatchCalibrationSuggestions,
    getMatchPerformanceAlertsController,
    getCityLiquidity,
    getCityExpansionSignalsController,
    getMarketAlertsController,
    getMarketControlOverview,
    getMarketInsightsController,
    getCompetitiveThreatSignalsController,
    getHiringTrajectoryController,
};
