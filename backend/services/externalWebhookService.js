const crypto = require('crypto');
const axios = require('axios');
const BackgroundJob = require('../models/BackgroundJob');
const WebhookDeliveryLog = require('../models/WebhookDeliveryLog');
const { Webhook } = require('../models/Webhook');
const logger = require('../utils/logger');

const WEBHOOK_QUEUE = 'external_webhooks';
const WEBHOOK_JOB_TYPE = 'external_webhook_delivery';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.EXTERNAL_WEBHOOK_TIMEOUT_MS || '6000', 10);

const generateWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;

const createIdempotencyKey = ({ webhookId, eventType, seed = '' }) => {
    const digest = crypto
        .createHash('sha256')
        .update(`${String(webhookId)}:${String(eventType)}:${String(seed)}`)
        .digest('hex');
    return `evt_${digest.slice(0, 32)}`;
};

const safeJson = (value) => {
    try {
        return JSON.stringify(value || {});
    } catch (_error) {
        return JSON.stringify({});
    }
};

const signWebhookPayload = ({ secret, payload, timestamp }) => {
    const payloadJson = safeJson(payload);
    const material = `${timestamp}.${payloadJson}`;
    const digest = crypto.createHmac('sha256', String(secret || '')).update(material).digest('hex');
    return {
        payloadJson,
        signatureHeader: `t=${timestamp},v1=${digest}`,
    };
};

const computeExponentialBackoffMs = (attempt = 1) => {
    const normalized = Math.max(1, Number.parseInt(attempt, 10) || 1);
    const base = Number.parseInt(process.env.EXTERNAL_WEBHOOK_RETRY_BASE_MS || '1000', 10);
    const max = Number.parseInt(process.env.EXTERNAL_WEBHOOK_RETRY_MAX_MS || String(30 * 60 * 1000), 10);
    return Math.min(max, base * (2 ** (normalized - 1)));
};

const queueWebhookDeliveries = async ({ ownerId, eventType, payload = {}, idempotencySeed = '' } = {}) => {
    const webhooks = await Webhook.find({
        ownerId,
        eventType,
        active: true,
    }).select('+secret');

    if (!Array.isArray(webhooks) || !webhooks.length) {
        return { queued: 0 };
    }

    let queued = 0;

    for (const webhook of webhooks) {
        const idempotencyKey = createIdempotencyKey({
            webhookId: webhook._id,
            eventType,
            seed: idempotencySeed || `${Date.now()}:${Math.random()}`,
        });

        try {
            const delivery = await WebhookDeliveryLog.create({
                webhookId: webhook._id,
                ownerId,
                eventType,
                targetUrl: webhook.targetUrl,
                idempotencyKey,
                payload,
                status: 'queued',
                responseStatus: null,
                responseBody: null,
                latency: null,
                attempt: 0,
                maxAttempts: Number.parseInt(process.env.EXTERNAL_WEBHOOK_MAX_ATTEMPTS || '5', 10),
                nextRetryAt: null,
                lastError: null,
            });

            await BackgroundJob.create({
                queue: WEBHOOK_QUEUE,
                type: WEBHOOK_JOB_TYPE,
                payload: {
                    deliveryLogId: delivery._id,
                },
                status: 'queued',
                attempts: 0,
                maxAttempts: delivery.maxAttempts,
                runAt: new Date(),
            });

            queued += 1;
        } catch (error) {
            if (Number(error?.code) !== 11000) {
                logger.warn({
                    event: 'external_webhook_queue_failed',
                    message: error.message,
                    webhookId: String(webhook._id),
                    ownerId: String(ownerId),
                    eventType,
                });
            }
        }
    }

    return { queued };
};

const markWebhookFailureState = async ({ webhook, disable = false }) => {
    if (!webhook?._id) return;

    const updates = disable
        ? {
            $set: {
                active: false,
                disabledAt: new Date(),
            },
        }
        : {};

    await Webhook.updateOne(
        { _id: webhook._id },
        {
            $inc: { consecutiveFailures: 1 },
            ...updates,
        }
    );
};

const markWebhookSuccessState = async ({ webhook }) => {
    if (!webhook?._id) return;
    await Webhook.updateOne(
        { _id: webhook._id },
        {
            $set: {
                consecutiveFailures: 0,
                lastDeliveryAt: new Date(),
            },
        }
    );
};

const processWebhookDeliveryJob = async (job) => {
    const deliveryLogId = job?.payload?.deliveryLogId;
    if (!deliveryLogId) {
        return { retry: false };
    }

    const delivery = await WebhookDeliveryLog.findById(deliveryLogId);
    if (!delivery) {
        return { retry: false };
    }

    if (delivery.status === 'success' || delivery.status === 'disabled') {
        return { retry: false };
    }

    const webhook = await Webhook.findById(delivery.webhookId).select('+secret');
    if (!webhook || webhook.active === false) {
        delivery.status = 'disabled';
        delivery.lastError = 'Webhook is inactive';
        delivery.nextRetryAt = null;
        await delivery.save();
        return { retry: false };
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const { payloadJson, signatureHeader } = signWebhookPayload({
        secret: webhook.secret,
        payload: delivery.payload,
        timestamp,
    });

    const attempt = Number(job.attempts || 1);
    delivery.attempt = attempt;

    const startedAt = process.hrtime.bigint();

    try {
        const response = await axios.post(webhook.targetUrl, payloadJson, {
            timeout: DEFAULT_TIMEOUT_MS,
            headers: {
                'content-type': 'application/json',
                'x-hire-event': delivery.eventType,
                'x-hire-signature': signatureHeader,
                'x-hire-idempotency-key': delivery.idempotencyKey,
            },
            maxRedirects: 0,
            validateStatus: () => true,
        });

        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        delivery.latency = Number(latencyMs.toFixed(2));
        delivery.responseStatus = Number(response.status || 0);
        delivery.responseBody = String(response.data || '').slice(0, 1000);

        if (response.status >= 200 && response.status < 300) {
            delivery.status = 'success';
            delivery.lastError = null;
            delivery.nextRetryAt = null;
            await delivery.save();
            await markWebhookSuccessState({ webhook });
            return { retry: false };
        }

        const failureError = new Error(`Webhook returned status ${response.status}`);
        failureError.statusCode = response.status;
        throw failureError;
    } catch (error) {
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        delivery.latency = Number(latencyMs.toFixed(2));
        delivery.responseStatus = Number(error?.response?.status || 0) || null;
        delivery.responseBody = String(error?.response?.data || '').slice(0, 1000) || null;
        delivery.lastError = String(error?.message || 'Webhook delivery failed').slice(0, 500);

        const willHitFailureThreshold = Number(webhook.consecutiveFailures || 0) + 1 >= Number(webhook.failureThreshold || 5);
        const exceededAttempts = attempt >= Number(job.maxAttempts || delivery.maxAttempts || 5);
        const shouldRetry = !willHitFailureThreshold && !exceededAttempts;

        if (willHitFailureThreshold) {
            delivery.status = 'disabled';
            delivery.nextRetryAt = null;
            await delivery.save();
            await markWebhookFailureState({ webhook, disable: true });
            return { retry: false };
        }

        await markWebhookFailureState({ webhook, disable: false });

        if (!shouldRetry) {
            delivery.status = 'failed';
            delivery.nextRetryAt = null;
            await delivery.save();
            return { retry: false };
        }

        const nextRetryAt = new Date(Date.now() + computeExponentialBackoffMs(attempt));
        delivery.status = 'failed';
        delivery.nextRetryAt = nextRetryAt;
        await delivery.save();

        return {
            retry: true,
            runAt: nextRetryAt,
            reason: delivery.lastError,
        };
    }
};

const buildWebhookTestPayload = ({ ownerId = null, eventType = 'job.created' } = {}) => ({
    type: eventType,
    emittedAt: new Date().toISOString(),
    source: 'hire.external.test',
    ownerExternalRef: ownerId ? String(ownerId) : null,
    data: {
        message: 'Test webhook delivery',
    },
});

module.exports = {
    WEBHOOK_QUEUE,
    WEBHOOK_JOB_TYPE,
    generateWebhookSecret,
    signWebhookPayload,
    computeExponentialBackoffMs,
    queueWebhookDeliveries,
    processWebhookDeliveryJob,
    buildWebhookTestPayload,
};
