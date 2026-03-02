require('dotenv').config();

const connectDB = require('../config/db');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');

const run = async () => {
    await connectDB();
    const job = await enqueueBackgroundJob({
        type: 'lifecycle_automation',
        payload: {
            source: 'cron_enqueue_lifecycle_automation',
            requestedAt: new Date().toISOString(),
        },
        runAt: new Date(),
        maxAttempts: 3,
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        event: 'lifecycle_automation_enqueued',
        jobId: String(job._id),
        queuedAt: new Date().toISOString(),
    }));
};

run()
    .then(() => process.exit(0))
    .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({
            event: 'lifecycle_automation_enqueue_failed',
            message: error.message,
        }));
        process.exit(1);
    });

