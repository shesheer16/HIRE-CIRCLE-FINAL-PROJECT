require('dotenv').config();

const connectDB = require('../config/db');
const { sendReengagementPushes } = require('../services/growthNotificationService');
const { sendEmployerSlowResponseReminders } = require('../services/growthConversionService');

const main = async () => {
    await connectDB();

    const [reengagement, slowResponse] = await Promise.all([
        sendReengagementPushes({
            inactiveDays: Number.parseInt(process.env.GROWTH_REENGAGEMENT_INACTIVE_DAYS || '5', 10),
            cooldownDays: Number.parseInt(process.env.GROWTH_REENGAGEMENT_COOLDOWN_DAYS || '5', 10),
        }),
        sendEmployerSlowResponseReminders({
            staleHours: Number.parseInt(process.env.GROWTH_EMPLOYER_RESPONSE_STALE_HOURS || '48', 10),
        }),
    ]);

    console.log(`[growth-engagement] reengagement sent=${reengagement.sentCount} scanned=${reengagement.scannedUsers}`);
    console.log(`[growth-engagement] slow-response reminders sent=${slowResponse.sentCount} targeted=${slowResponse.targetedEmployers}`);
    process.exit(0);
};

main().catch((error) => {
    console.warn('[growth-engagement] failed:', error.message);
    process.exit(1);
});
