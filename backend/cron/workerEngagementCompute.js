require('dotenv').config();

const connectDB = require('../config/db');
const { computeWorkerEngagementScoresBatch } = require('../services/workerEngagementService');

const main = async () => {
    await connectDB();
    const rows = await computeWorkerEngagementScoresBatch({
        batchSize: 500,
        hardCap: 5000,
    });
    console.log(`[worker-engagement] updated ${rows.length} worker engagement scores`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[worker-engagement] failed:', error.message);
    process.exit(1);
});
