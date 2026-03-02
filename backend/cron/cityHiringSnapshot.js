require('dotenv').config();

const connectDB = require('../config/db');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const CityHiringDailySnapshot = require('../models/CityHiringDailySnapshot');
const { startOfUtcDay, addUtcDays } = require('../utils/timezone');

const runCityHiringSnapshot = async () => {
    const dayStart = startOfUtcDay(new Date());
    const previousDayStart = addUtcDays(dayStart, -1);
    const previousDayEnd = new Date(dayStart.getTime() - 1);

    const rows = await HiringLifecycleEvent.aggregate([
        {
            $match: {
                occurredAt: { $gte: previousDayStart, $lte: previousDayEnd },
            },
        },
        {
            $group: {
                _id: '$city',
                applications: {
                    $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_CREATED'] }, 1, 0] },
                },
                shortlisted: {
                    $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_SHORTLISTED'] }, 1, 0] },
                },
                hired: {
                    $sum: { $cond: [{ $eq: ['$eventType', 'APPLICATION_HIRED'] }, 1, 0] },
                },
                interviewsCompleted: {
                    $sum: { $cond: [{ $eq: ['$eventType', 'INTERVIEW_CONFIRMED'] }, 1, 0] },
                },
                retention30d: {
                    $sum: { $cond: [{ $eq: ['$eventType', 'RETENTION_30D'] }, 1, 0] },
                },
            },
        },
    ]);

    for (const row of rows) {
        await CityHiringDailySnapshot.updateOne(
            {
                city: row._id || 'Hyderabad',
                day: previousDayStart,
            },
            {
                $set: {
                    metrics: {
                        applications: row.applications || 0,
                        shortlisted: row.shortlisted || 0,
                        hired: row.hired || 0,
                        interviewsCompleted: row.interviewsCompleted || 0,
                        retention30d: row.retention30d || 0,
                        offerProposed: 0,
                        offerAccepted: 0,
                        noShowNumerator: 0,
                        noShowDenominator: 0,
                    },
                },
            },
            { upsert: true }
        );
    }

    console.log(`[city-snapshot] upserted ${rows.length} city rows for ${previousDayStart.toISOString().slice(0, 10)}`);
};

const main = async () => {
    await connectDB();
    await runCityHiringSnapshot();
    process.exit(0);
};

main().catch((error) => {
    console.warn('[city-snapshot] failed:', error.message);
    process.exit(1);
});
