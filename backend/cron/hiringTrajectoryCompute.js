require('dotenv').config();

const connectDB = require('../config/db');
const { computeHiringTrajectoryBatch } = require('../services/hiringTrajectoryService');

const main = async () => {
    await connectDB();
    const rows = await computeHiringTrajectoryBatch({
        batchSize: 500,
        hardCap: 2000,
    });
    console.log(`[hiring-trajectory] updated ${rows.length} trajectory rows`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[hiring-trajectory] failed:', error.message);
    process.exit(1);
});
