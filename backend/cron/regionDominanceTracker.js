require('dotenv').config();

const connectDB = require('../config/db');
const { computeRegionDominance } = require('../services/marketIntelligenceShieldService');

const runRegionDominanceTracker = async () => {
    const limit = Number.parseInt(process.env.MARKET_REGION_DOMINANCE_LIMIT || '300', 10);
    const snapshots = await computeRegionDominance({ limit });
    const campaignCount = snapshots.filter((row) => row.campaignTriggered).length;

    console.log(`[region-dominance-tracker] snapshots=${snapshots.length} campaigns=${campaignCount}`);
};

const main = async () => {
    await connectDB();
    await runRegionDominanceTracker();
    process.exit(0);
};

main().catch((error) => {
    console.warn('[region-dominance-tracker] failed:', error.message);
    process.exit(1);
});
