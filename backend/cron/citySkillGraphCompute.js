require('dotenv').config();

const connectDB = require('../config/db');
const { computeCitySkillGraph } = require('../services/citySkillGraphService');

const main = async () => {
    await connectDB();
    const rows = await computeCitySkillGraph({ day: new Date() });
    console.log(`[city-skill-graph] upserted ${rows.length} graph rows`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[city-skill-graph] failed:', error.message);
    process.exit(1);
});
