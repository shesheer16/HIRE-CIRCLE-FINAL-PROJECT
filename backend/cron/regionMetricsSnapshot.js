require('dotenv').config();

const connectDB = require('../config/db');
const { snapshotRegionMetrics } = require('../services/regionMetricsService');

const normalizeCsv = (value = '') => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const runRegionMetricsSnapshot = async () => {
    const regions = normalizeCsv(process.env.REGION_METRICS_REGIONS || 'GLOBAL');
    const countries = normalizeCsv(process.env.REGION_METRICS_COUNTRIES || 'GLOBAL');

    let count = 0;

    for (const country of countries) {
        for (const region of regions) {
            await snapshotRegionMetrics({ region, country });
            count += 1;
        }
    }

    console.log(`[region-metrics-snapshot] captured ${count} region snapshots`);
};

const main = async () => {
    await connectDB();
    await runRegionMetricsSnapshot();
    process.exit(0);
};

main().catch((error) => {
    console.warn('[region-metrics-snapshot] failed:', error.message);
    process.exit(1);
});
