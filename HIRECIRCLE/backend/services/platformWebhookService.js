const axios = require('axios');
const crypto = require('crypto');

const { Webhook } = require('../models/Webhook');
const WebhookDeliveryLog = require('../models/WebhookDeliveryLog');
const { appendPlatformAuditLog } = require('./platformAuditService');

const WEBHOOK_TIMEOUT_MS = Number.parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10);
const WEBHOOK_MAX_ATTEMPTS = Number.parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || '3', 10);
const WEBHOOK_RETRY_BASE_MS = Number.parseInt(process.env.WEBHOOK_RETRY_BASE_MS || '1000', 10);

const SUPPORTED_PLATFORM_EVENTS = new Set([
    'application.received',
    'interview.scheduled',
    'offer.accepted',
    'hire.completed',
]);

const generateWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;

const buildSignature = ({ secret, timestamp, payload }) => {
    const serialized = JSON.stringify(payload || {});
    const digest = crypto
        .createHmac('sha256', String(secret || ''))
        .update(`${timestamp}.${serialized}`)
        .digest('hex');

    return `v1=${digest}`;
};

const registerWebhookSubscription = async ({ ownerId, tenantId = null, eventType, targetUrl } = {}) => {
    const normalizedEvent = String(eventType || '').trim().toLowerCase();
    if (!SUPPORTED_PLATFORM_EVENTS.has(normalizedEvent)) {
        throw new Error('Unsupported webhook event type');
    }

    const normalizedTarget = String(targetUrl || '').trim();
    if (!normalizedTarget || !/^https:\/\//i.test(normalizedTarget)) {
        throw new Error('Webhook targetUrl must be HTTPS');
    }

    const existing = await Webhook.findOne({
        ownerId,
        tenantId,
        eventType: normalizedEvent,
        targetUrl: normalizedTarget,
    }).select('+secret');

    if (existing) {
        existing.active = true;
        existing.disabledAt = null;
        existing.failureThreshold = WEBHOOK_MAX_ATTEMPTS;
        await existing.save();

        return {
            webhook: existing,
            secret: null,
            created: false,
        };
    }

    const secret = generateWebhookSecret();
    const created = await Webhook.create({
        ownerId,
        tenantId,
        eventType: normalizedEvent,
        targetUrl: normalizedTarget,
        secret,
        active: true,
        failureThreshold: WEBHOOK_MAX_ATTEMPTS,
    });

    await appendPlatformAuditLog({
        eventType: 'webhook.registered',
        actorType: 'user',
        actorId: ownerId,
        tenantId,
        resourceType: 'webhook',
        resourceId: created._id,
        action: 'register',
        status: 201,
        metadata: {
            eventType: normalizedEvent,
            targetUrl: normalizedTarget,
        },
    });

    return {
        webhook: created,
        secret,
        created: true,
    };
};

const listWebhookSubscriptions = async ({ ownerId, tenantId = null } = {}) => (
    Webhook.find({ ownerId, tenantId }).sort({ createdAt: -1 }).lean()
);

const disableWebhookIfThresholdExceeded = async ({ webhook }) => {
    const threshold = Number(webhook.failureThreshold || WEBHOOK_MAX_ATTEMPTS);
    if (Number(webhook.consecutiveFailures || 0) < threshold) return;

    webhook.active = false;
    webhook.disabledAt = new Date();
    await webhook.save();

    await appendPlatformAuditLog({
        eventType: 'webhook.disabled',
        actorType: 'system',
        actorId: null,
        tenantId: webhook.tenantId || null,
        resourceType: 'webhook',
        resourceId: webhook._id,
        action: 'auto_disable',
        status: 200,
        metadata: {
            consecutiveFailures: webhook.consecutiveFailures,
            threshold,
        },
    });
};

const attemptWebhookDelivery = async ({ deliveryId }) => {
    const delivery = await WebhookDeliveryLog.findById(deliveryId);
    if (!delivery || delivery.status === 'success' || delivery.status === 'disabled') {
        return;
    }

    const webhook = await Webhook.findById(delivery.webhookId).select('+secret');
    if (!webhook || !webhook.active) {
        if (delivery.status !== 'disabled') {
            delivery.status = 'disabled';
            delivery.lastError = 'Webhook disabled or removed';
            await delivery.save();
        }
        return;
    }

    const attempt = Number(delivery.attempt || 0) + 1;
    delivery.attempt = attempt;
    delivery.maxAttempts = WEBHOOK_MAX_ATTEMPTS;

    const timestamp = String(Date.now());
    const payload = {
        eventType: delivery.eventType,
        payload: delivery.payload,
        sentAt: new Date().toISOString(),
        deliveryId: String(delivery._id),
    };
    const signature = buildSignature({
        secret: webhook.secret,
        timestamp,
        payload,
    });

    const startedAt = process.hrtime.bigint();

    try {
        const response = await axios.post(delivery.targetUrl, payload, {
            timeout: WEBHOOK_TIMEOUT_MS,
            validateStatus: () => true,
            headers: {
                'Content-Type': 'application/json',
                'X-Hire-Signature': signature,
                'X-Hire-Signature-Timestamp': timestamp,
                'X-Hire-Event': delivery.eventType,
                'X-Hire-Delivery-Id': String(delivery._id),
                'User-Agent': 'Hire-Webhook-Dispatcher/1.0',
            },
        });

        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        delivery.latency = Number(latencyMs.toFixed(2));
        delivery.responseStatus = Number(response.status || 0);
        delivery.responseBody = typeof response.data === 'string'
            ? response.data.slice(0, 500)
            : JSON.stringify(response.data || {}).slice(0, 500);

        if (response.status >= 200 && response.status < 300) {
            delivery.status = 'success';
            delivery.lastError = null;
            delivery.nextRetryAt = null;
            webhook.consecutiveFailures = 0;
            webhook.lastDeliveryAt = new Date();

            await Promise.all([delivery.save(), webhook.save()]);

            await appendPlatformAuditLog({
                eventType: 'webhook.delivered',
                actorType: 'system',
                actorId: null,
                tenantId: webhook.tenantId || null,
                resourceType: 'webhook_delivery',
                resourceId: delivery._id,
                action: 'deliver',
                status: response.status,
                metadata: {
                    webhookId: String(webhook._id),
                    attempt,
                    eventType: delivery.eventType,
                },
            });
            return;
        }

        throw new Error(`HTTP_${response.status}`);
    } catch (error) {
        delivery.status = 'failed';
        delivery.lastError = String(error.message || 'Webhook delivery failed').slice(0, 500);

        webhook.consecutiveFailures = Number(webhook.consecutiveFailures || 0) + 1;
        await Promise.all([delivery.save(), webhook.save()]);
        await disableWebhookIfThresholdExceeded({ webhook });

        if (attempt < WEBHOOK_MAX_ATTEMPTS && webhook.active) {
            const delayMs = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            delivery.nextRetryAt = new Date(Date.now() + delayMs);
            await delivery.save();

            setTimeout(() => {
                void attemptWebhookDelivery({ deliveryId: delivery._id });
            }, delayMs);
        }

        await appendPlatformAuditLog({
            eventType: 'webhook.delivery_failed',
            actorType: 'system',
            actorId: null,
            tenantId: webhook.tenantId || null,
            resourceType: 'webhook_delivery',
            resourceId: delivery._id,
            action: 'deliver_failed',
            status: 500,
            metadata: {
                webhookId: String(webhook._id),
                attempt,
                eventType: delivery.eventType,
                error: delivery.lastError,
            },
        });
    }
};

const queueWebhookEvent = async ({ ownerId, tenantId = null, eventType, payload = {} } = {}) => {
    const normalizedEvent = String(eventType || '').trim().toLowerCase();
    if (!SUPPORTED_PLATFORM_EVENTS.has(normalizedEvent)) {
        return { queued: 0 };
    }

    const webhooks = await Webhook.find({
        ownerId,
        tenantId,
        eventType: normalizedEvent,
        active: true,
    }).lean();

    if (!Array.isArray(webhooks) || !webhooks.length) {
        return { queued: 0 };
    }

    const queuedLogs = await Promise.all(webhooks.map((hook) => WebhookDeliveryLog.create({
        webhookId: hook._id,
        ownerId,
        eventType: normalizedEvent,
        targetUrl: hook.targetUrl,
        idempotencyKey: crypto.randomUUID(),
        payload,
        status: 'queued',
        attempt: 0,
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    })));

    queuedLogs.forEach((log) => {
        setImmediate(() => {
            void attemptWebhookDelivery({ deliveryId: log._id });
        });
    });

    return {
        queued: queuedLogs.length,
    };
};

module.exports = {
    SUPPORTED_PLATFORM_EVENTS,
    registerWebhookSubscription,
    listWebhookSubscriptions,
    queueWebhookEvent,
};
