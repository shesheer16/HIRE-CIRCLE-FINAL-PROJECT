const { runStrategicAnalyticsDaily, getLatestStrategicDashboard } = require('../services/strategicAnalyticsService');
const { getLatestInsights } = require('../services/strategicInsightsService');

const parseDate = (rawValue) => {
    if (!rawValue) return null;
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
    }
    return fallback;
};

const getStrategicDashboard = async (_req, res) => {
    try {
        const data = await getLatestStrategicDashboard();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to load strategic dashboard',
            error: error.message,
        });
    }
};

const getStrategicInsights = async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit || '20', 10);
        const rows = await getLatestInsights({ limit });
        return res.status(200).json({
            count: rows.length,
            insights: rows,
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to load strategic insights',
            error: error.message,
        });
    }
};

const triggerStrategicAggregation = async (req, res) => {
    try {
        const day = parseDate(req.body?.day || req.query?.day) || undefined;
        const source = String(req.body?.source || req.query?.source || 'manual_trigger').trim();
        const force = parseBoolean(req.body?.force ?? req.query?.force, false);

        const result = await runStrategicAnalyticsDaily({
            day,
            source,
            force,
        });

        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            message: 'Strategic aggregation failed',
            error: error.message,
        });
    }
};

module.exports = {
    getStrategicDashboard,
    getStrategicInsights,
    triggerStrategicAggregation,
};
