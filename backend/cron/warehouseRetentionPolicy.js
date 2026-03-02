require('dotenv').config();

const connectDB = require('../config/db');
const { runWarehouseRetentionPolicy } = require('../services/warehouseRetentionService');

const main = async () => {
    await connectDB();
    const result = await runWarehouseRetentionPolicy();
    console.log(`[warehouse-retention-policy] ${JSON.stringify(result)}`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[warehouse-retention-policy] failed:', error.message);
    process.exit(1);
});
