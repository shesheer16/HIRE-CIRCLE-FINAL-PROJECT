require('dotenv').config();

const connectDB = require('../config/db');
const { computeDailyCityLiquidity } = require('../services/cityLiquidityService');

const main = async () => {
    await connectDB();
    const rows = await computeDailyCityLiquidity({ day: new Date() });
    console.log(`[city-liquidity] upserted ${rows.length} city liquidity rows`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[city-liquidity] failed:', error.message);
    process.exit(1);
});
