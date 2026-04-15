const redisClient = require('../config/redis');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { Event } = require('../models/Event');
const Subscription = require('../models/Subscription');
const RevenueEvent = require('../models/RevenueEvent');
const { toPublicId } = require('./externalProjectionService');
const { queueWebhookDeliveries } = require('./externalWebhookService');

const DEFAULT_POLL_MS = Number.parseInt(process.env.EXTERNAL_EVENT_BRIDGE_POLL_MS || '15000', 10);
const LOOKBACK_MS = Number.parseInt(process.env.EXTERNAL_EVENT_BRIDGE_LOOKBACK_MS || String(10 * 60 * 1000), 10);
const SOURCE_LIMIT = Number.parseInt(process.env.EXTERNAL_EVENT_BRIDGE_BATCH_SIZE || '100', 10);

const ACCEPTED_STATUSES = new Set(['accepted', 'hired', 'offer_accepted']);

const checkpointKey = (name) => `ext:event_bridge:checkpoint:${name}`;

const toDate = (value, fallback = null) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed;
};

const readCheckpoint = async (name) => {
    const value = await redisClient.get(checkpointKey(name));
    const fallback = new Date(Date.now() - LOOKBACK_MS);
    return toDate(value, fallback);
};

const writeCheckpoint = async (name, dateValue) => {
    await redisClient.set(checkpointKey(name), new Date(dateValue).toISOString());
};

const buildJobCreatedPayload = (job) => ({
    jobExternalId: toPublicId('job', job._id),
    title: job.title,
    companyName: job.companyName,
    location: job.location,
    status: job.status,
    createdAt: job.createdAt,
});

const buildJobClosedPayload = (job) => ({
    jobExternalId: toPublicId('job', job._id),
    title: job.title,
    companyName: job.companyName,
    status: job.status,
    isOpen: Boolean(job.isOpen),
    updatedAt: job.updatedAt,
});

const buildApplicationPayload = (application) => ({
    applicationExternalId: toPublicId('application', application._id),
    jobExternalId: toPublicId('job', application.job),
    candidateExternalId: toPublicId('candidate', application.worker),
    status: application.status,
    submittedAt: application.createdAt,
    updatedAt: application.updatedAt,
});

const buildInterviewPayload = (row) => ({
    interviewExternalId: toPublicId('interview', row._id),
    completedAt: row.createdAt,
    meta: row.meta || {},
});

const buildEscrowPayload = (row) => ({
    escrowExternalId: toPublicId('escrow', row._id),
    amount: Number(row.amountInr || 0),
    currency: row.currency,
    settledAt: row.settledAt || row.updatedAt,
    metadata: row.metadata || {},
});

const buildSubscriptionPayload = (row) => ({
    subscriptionExternalId: toPublicId('subscription', row._id),
    planType: row.planType,
    status: row.status,
    startDate: row.startDate,
    expiryDate: row.expiryDate,
    updatedAt: row.updatedAt,
});

const dispatchRows = async ({ rows = [], name, eventType, ownerResolver, payloadResolver, checkpointResolver }) => {
    let checkpoint = null;

    for (const row of rows) {
        const ownerId = ownerResolver(row);
        if (!ownerId) continue;

        const payload = payloadResolver(row);
        const seed = `${String(row._id)}:${String(checkpointResolver(row) || row.updatedAt || row.createdAt || Date.now())}`;

        await queueWebhookDeliveries({
            ownerId,
            eventType,
            payload,
            idempotencySeed: seed,
        });

        const candidateCheckpoint = checkpointResolver(row) || row.updatedAt || row.createdAt;
        if (candidateCheckpoint) {
            const maybeDate = new Date(candidateCheckpoint);
            if (!checkpoint || maybeDate > checkpoint) {
                checkpoint = maybeDate;
            }
        }
    }

    if (!checkpoint) {
        checkpoint = new Date();
    }

    await writeCheckpoint(name, checkpoint);
};

const pollJobCreated = async () => {
    const name = 'job_created';
    const since = await readCheckpoint(name);
    const rows = await Job.find({ createdAt: { $gt: since } })
        .sort({ createdAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('employerId title companyName location status createdAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'job.created',
        ownerResolver: (row) => row.employerId,
        payloadResolver: buildJobCreatedPayload,
        checkpointResolver: (row) => row.createdAt,
    });
};

const pollJobClosed = async () => {
    const name = 'job_closed';
    const since = await readCheckpoint(name);
    const rows = await Job.find({
        updatedAt: { $gt: since },
        $or: [
            { status: 'closed' },
            { isOpen: false },
        ],
    })
        .sort({ updatedAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('employerId title companyName status isOpen updatedAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'job.closed',
        ownerResolver: (row) => row.employerId,
        payloadResolver: buildJobClosedPayload,
        checkpointResolver: (row) => row.updatedAt,
    });
};

const pollApplicationSubmitted = async () => {
    const name = 'application_submitted';
    const since = await readCheckpoint(name);
    const rows = await Application.find({ createdAt: { $gt: since } })
        .sort({ createdAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('employer worker job status createdAt updatedAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'application.submitted',
        ownerResolver: (row) => row.employer,
        payloadResolver: buildApplicationPayload,
        checkpointResolver: (row) => row.createdAt,
    });
};

const pollApplicationAccepted = async () => {
    const name = 'application_accepted';
    const since = await readCheckpoint(name);
    const rows = await Application.find({
        updatedAt: { $gt: since },
        status: { $in: Array.from(ACCEPTED_STATUSES) },
    })
        .sort({ updatedAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('employer worker job status createdAt updatedAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'application.accepted',
        ownerResolver: (row) => row.employer,
        payloadResolver: buildApplicationPayload,
        checkpointResolver: (row) => row.updatedAt,
    });
};

const pollInterviewCompleted = async () => {
    const name = 'interview_completed';
    const since = await readCheckpoint(name);
    const rows = await Event.find({
        type: 'interview_complete',
        createdAt: { $gt: since },
    })
        .sort({ createdAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('userId meta createdAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'interview.completed',
        ownerResolver: (row) => row.userId,
        payloadResolver: buildInterviewPayload,
        checkpointResolver: (row) => row.createdAt,
    });
};

const pollEscrowReleased = async () => {
    const name = 'escrow_released';
    const since = await readCheckpoint(name);
    const rows = await RevenueEvent.find({
        updatedAt: { $gt: since },
        eventType: { $in: ['boost_purchase', 'subscription_charge'] },
        status: 'succeeded',
    })
        .sort({ updatedAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('employerId amountInr currency metadata settledAt updatedAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'escrow.released',
        ownerResolver: (row) => row.employerId,
        payloadResolver: buildEscrowPayload,
        checkpointResolver: (row) => row.updatedAt,
    });
};

const pollSubscriptionUpdated = async () => {
    const name = 'subscription_updated';
    const since = await readCheckpoint(name);
    const rows = await Subscription.find({
        updatedAt: { $gt: since },
    })
        .sort({ updatedAt: 1 })
        .limit(SOURCE_LIMIT)
        .select('userId planType status startDate expiryDate updatedAt')
        .lean();

    await dispatchRows({
        rows,
        name,
        eventType: 'subscription.updated',
        ownerResolver: (row) => row.userId,
        payloadResolver: buildSubscriptionPayload,
        checkpointResolver: (row) => row.updatedAt,
    });
};

const runBridgeCycle = async () => {
    await pollJobCreated();
    await pollJobClosed();
    await pollApplicationSubmitted();
    await pollApplicationAccepted();
    await pollInterviewCompleted();
    await pollEscrowReleased();
    await pollSubscriptionUpdated();
};

let timer = null;
let isRunning = false;

const startExternalEventBridge = () => {
    if (timer) return;

    timer = setInterval(() => {
        if (isRunning) return;
        isRunning = true;
        void runBridgeCycle()
            .catch(() => null)
            .finally(() => {
                isRunning = false;
            });
    }, DEFAULT_POLL_MS);

    isRunning = true;
    void runBridgeCycle()
        .catch(() => null)
        .finally(() => {
            isRunning = false;
        });
};

const stopExternalEventBridge = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
};

module.exports = {
    startExternalEventBridge,
    stopExternalEventBridge,
    runBridgeCycle,
};
