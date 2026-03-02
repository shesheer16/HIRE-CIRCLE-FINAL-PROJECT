require('dotenv').config();

const connectDB = require('../config/db');
const { runStrategicAnalyticsDaily } = require('../services/strategicAnalyticsService');

const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const main = async () => {
    await connectDB();
    const day = parseDate(process.env.STRATEGIC_ANALYTICS_DAY) || new Date(Date.now() - (24 * 60 * 60 * 1000));
    const force = String(process.env.STRATEGIC_ANALYTICS_FORCE || '').toLowerCase() === 'true';
    const result = await runStrategicAnalyticsDaily({
        day,
        source: 'cron',
        force,
    });

    console.log(`[strategic-analytics-daily] ${JSON.stringify(result)}`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[strategic-analytics-daily] failed:', error.message);
    process.exit(1);
});
