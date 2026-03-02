require('dotenv').config();

const connectDB = require('../config/db');
const { detectMarketAnomalies } = require('../services/marketAnomalyService');

const main = async () => {
    await connectDB();
    const rows = await detectMarketAnomalies({ day: new Date() });
    console.log(`[market-anomaly] generated ${rows.length} alerts`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[market-anomaly] failed:', error.message);
    process.exit(1);
});
