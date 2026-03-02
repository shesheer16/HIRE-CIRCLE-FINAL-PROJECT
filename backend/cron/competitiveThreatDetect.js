require('dotenv').config();

const connectDB = require('../config/db');
const { detectCompetitiveThreatSignals } = require('../services/competitiveThreatService');

const main = async () => {
    await connectDB();
    const rows = await detectCompetitiveThreatSignals({ day: new Date() });
    console.log(`[competitive-threat] generated ${rows.length} signals`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[competitive-threat] failed:', error.message);
    process.exit(1);
});
