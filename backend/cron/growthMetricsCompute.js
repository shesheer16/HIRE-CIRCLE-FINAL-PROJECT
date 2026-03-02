require('dotenv').config();

const connectDB = require('../config/db');
const { upsertGrowthMetricsForDay } = require('../services/growthMetricsService');

const main = async () => {
    await connectDB();
    const metrics = await upsertGrowthMetricsForDay(new Date());
    console.log(`[growth-metrics] updated dateKey=${metrics?.dateKey}`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[growth-metrics] failed:', error.message);
    process.exit(1);
});
