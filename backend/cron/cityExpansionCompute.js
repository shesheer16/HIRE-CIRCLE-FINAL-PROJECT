require('dotenv').config();

const connectDB = require('../config/db');
const { computeCityExpansionSignals } = require('../services/cityExpansionSignalService');

const main = async () => {
    await connectDB();
    const rows = await computeCityExpansionSignals({ day: new Date() });
    console.log(`[city-expansion] upserted ${rows.length} expansion signal rows`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[city-expansion] failed:', error.message);
    process.exit(1);
});
