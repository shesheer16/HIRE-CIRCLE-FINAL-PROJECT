const crypto = require('crypto');

const logger = require('../utils/logger');
const { appendPlatformAuditLog } = require('./platformAuditService');
const { emitStructuredAlert } = require('./systemMonitoringService');

const REGION_REPLICATION_ENABLED = String(process.env.REGION_REPLICATION_ENABLED || 'true').toLowerCase() !== 'false';
const REGION_REPLICATION_INTERVAL_MS = Number.parseInt(process.env.REGION_REPLICATION_INTERVAL_MS || '1500', 10);
const REGION_REPLICATION_CONCURRENCY = Math.max(1, Number.parseInt(process.env.REGION_REPLICATION_CONCURRENCY || '4', 10));
const REGION_REPLICATION_RETRY_LIMIT = Math.max(1, Number.parseInt(process.env.REGION_REPLICATION_RETRY_LIMIT || '3', 10));
const REGION_REPLICATION_TIMEOUT_MS = Math.max(250, Number.parseInt(process.env.REGION_REPLICATION_TIMEOUT_MS || '2500', 10));
const REGION_REPLICATION_MAX_QUEUE = Math.max(100, Number.parseInt(process.env.REGION_REPLICATION_MAX_QUEUE || '10000', 10));

const parseEndpoints = () => {
    const raw = String(process.env.REGION_REPLICATION_ENDPOINTS_JSON || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        const entries = {};
        Object.entries(parsed).forEach(([region, endpoint]) => {
            const normalizedRegion = String(region || '').trim().toLowerCase();
            const normalizedEndpoint = String(endpoint || '').trim().replace(/\/$/, '');
            if (!normalizedRegion || !normalizedEndpoint) return;
            entries[normalizedRegion] = normalizedEndpoint;
        });
        return entries;
    } catch (_error) {
        return {};
    }
};

const shouldUseRelativePath = (url) => /^https?:\/\//i.test(String(url || ''));

const resolveTargetUrls = ({ sourceRegion, failoverRegions = [] } = {}) => {
    const endpointMap = parseEndpoints();
    const source = String(sourceRegion || '').trim().toLowerCase();
    const failovers = Array.from(new Set((Array.isArray(failoverRegions) ? failoverRegions : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .filter((value) => value !== source)));

    const rows = failovers
        .map((region) => ({
            region,
            baseUrl: endpointMap[region] || null,
        }))
        .filter((row) => Boolean(row.baseUrl));

    return rows.map((row) => ({
        region: row.region,
        url: shouldUseRelativePath(row.baseUrl)
            ? `${row.baseUrl}/internal/replication/events`
            : row.baseUrl,
    }));
};

const state = {
    queue: [],
    timer: null,
    inFlight: 0,
    stats: {
        enqueued: 0,
        dispatched: 0,
        failed: 0,
        retried: 0,
        dropped: 0,
        lastEnqueuedAt: null,
        lastDispatchedAt: null,
        lastFailedAt: null,
        lastError: null,
    },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const postWithTimeout = async ({ url, payload }) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REGION_REPLICATION_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-internal-replication': 'hire-v1',
                'x-replication-key': String(process.env.REGION_REPLICATION_SHARED_KEY || '').trim(),
            },
            body: JSON.stringify(payload || {}),
            signal: controller.signal,
        });

        const text = await response.text().catch(() => '');
        return {
            ok: response.ok,
            status: response.status,
            body: String(text || '').slice(0, 500),
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
};

const buildReplicationPayload = (event) => ({
    eventId: event.id,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId,
    sourceRegion: event.sourceRegion,
    failoverRegions: event.failoverRegions,
    occurredAt: event.occurredAt,
    metadata: event.metadata || {},
    payload: event.payload || {},
});

const deliverEventToTarget = async ({ event, target }) => {
    const payload = buildReplicationPayload(event);
    let lastError = null;

    for (let attempt = 1; attempt <= REGION_REPLICATION_RETRY_LIMIT; attempt += 1) {
        try {
            const result = await postWithTimeout({ url: target.url, payload });
            if (result.ok) {
                return {
                    success: true,
                    status: result.status,
                };
            }
            lastError = new Error(`HTTP_${result.status}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < REGION_REPLICATION_RETRY_LIMIT) {
            await sleep(100 * attempt);
        }
    }

    return {
        success: false,
        status: null,
        error: lastError?.message || 'replication_delivery_failed',
    };
};

const handleReplicationFailure = async ({ event, failures }) => {
    state.stats.failed += 1;
    state.stats.lastFailedAt = new Date().toISOString();
    state.stats.lastError = failures.map((row) => `${row.region}:${row.error}`).join('; ');

    await emitStructuredAlert({
        alertType: 'region_replication_delivery_failed',
        metric: 'error_count',
        value: failures.length,
        threshold: 1,
        severity: failures.length >= 2 ? 'critical' : 'warning',
        source: 'region_replication',
        message: 'Cross-region replication delivery failed',
        details: {
            eventId: event.id,
            eventType: event.eventType,
            sourceRegion: event.sourceRegion,
            failedTargets: failures,
        },
        rateLimitWindowSeconds: Number.parseInt(process.env.REGION_REPLICATION_ALERT_WINDOW_SECONDS || '60', 10),
    }).catch(() => {});

    await appendPlatformAuditLog({
        eventType: 'region.replication.failed',
        actorType: 'system',
        action: 'replication_dispatch',
        status: 500,
        metadata: {
            eventId: event.id,
            eventType: event.eventType,
            sourceRegion: event.sourceRegion,
            failures,
        },
    }).catch(() => {});
};

const dispatchEvent = async (event) => {
    const targets = resolveTargetUrls({
        sourceRegion: event.sourceRegion,
        failoverRegions: event.failoverRegions,
    });

    if (!targets.length) {
        state.stats.dispatched += 1;
        state.stats.lastDispatchedAt = new Date().toISOString();
        await appendPlatformAuditLog({
            eventType: 'region.replication.skipped',
            actorType: 'system',
            action: 'replication_dispatch',
            status: 204,
            metadata: {
                eventId: event.id,
                eventType: event.eventType,
                sourceRegion: event.sourceRegion,
                reason: 'no_target_endpoints',
            },
        }).catch(() => {});
        return;
    }

    const failures = [];
    for (const target of targets) {
        const result = await deliverEventToTarget({ event, target });
        if (!result.success) {
            failures.push({
                region: target.region,
                error: result.error || 'unknown',
            });
        }
    }

    if (!failures.length) {
        state.stats.dispatched += 1;
        state.stats.lastDispatchedAt = new Date().toISOString();
        await appendPlatformAuditLog({
            eventType: 'region.replication.dispatched',
            actorType: 'system',
            action: 'replication_dispatch',
            status: 200,
            metadata: {
                eventId: event.id,
                eventType: event.eventType,
                sourceRegion: event.sourceRegion,
                targets: targets.map((row) => row.region),
            },
        }).catch(() => {});
        return;
    }

    if (event.attempts + 1 < REGION_REPLICATION_RETRY_LIMIT) {
        state.stats.retried += 1;
        state.queue.push({
            ...event,
            attempts: event.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
        });
        return;
    }

    await handleReplicationFailure({ event, failures });
};

const flushQueue = async () => {
    if (!REGION_REPLICATION_ENABLED) return;
    if (state.inFlight >= REGION_REPLICATION_CONCURRENCY) return;

    while (state.queue.length > 0 && state.inFlight < REGION_REPLICATION_CONCURRENCY) {
        const event = state.queue.shift();
        state.inFlight += 1;

        Promise.resolve(dispatchEvent(event))
            .catch((error) => {
                logger.warn({
                    event: 'region_replication_dispatch_error',
                    message: error.message,
                    replicationEventId: event.id,
                });
            })
            .finally(() => {
                state.inFlight = Math.max(0, state.inFlight - 1);
            });
    }
};

const enqueueReplicationEvent = async ({
    eventType,
    entityType = null,
    entityId = null,
    sourceRegion = process.env.APP_REGION || process.env.AWS_REGION || 'unknown',
    failoverRegions = [],
    metadata = {},
    payload = {},
} = {}) => {
    if (!REGION_REPLICATION_ENABLED) {
        return {
            accepted: false,
            reason: 'disabled',
        };
    }

    const normalizedEventType = String(eventType || '').trim();
    if (!normalizedEventType) {
        return {
            accepted: false,
            reason: 'event_type_required',
        };
    }

    if (state.queue.length >= REGION_REPLICATION_MAX_QUEUE) {
        state.queue.shift();
        state.stats.dropped += 1;
    }

    const event = {
        id: `repl_${crypto.randomUUID()}`,
        eventType: normalizedEventType,
        entityType: entityType ? String(entityType) : null,
        entityId: entityId ? String(entityId) : null,
        sourceRegion: String(sourceRegion || 'unknown').trim(),
        failoverRegions: Array.from(new Set((Array.isArray(failoverRegions) ? failoverRegions : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean))),
        occurredAt: new Date().toISOString(),
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        payload: payload && typeof payload === 'object' ? payload : {},
        attempts: 0,
        lastAttemptAt: null,
    };

    state.queue.push(event);
    state.stats.enqueued += 1;
    state.stats.lastEnqueuedAt = new Date().toISOString();
    void flushQueue();

    return {
        accepted: true,
        eventId: event.id,
    };
};

const startRegionReplicationDispatcher = () => {
    if (!REGION_REPLICATION_ENABLED || state.timer) return;
    state.timer = setInterval(() => {
        void flushQueue();
    }, Math.max(200, REGION_REPLICATION_INTERVAL_MS));

    if (typeof state.timer.unref === 'function') {
        state.timer.unref();
    }

    void flushQueue();
};

const stopRegionReplicationDispatcher = () => {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
};

const getRegionReplicationSnapshot = () => ({
    enabled: REGION_REPLICATION_ENABLED,
    running: Boolean(state.timer),
    queueDepth: state.queue.length,
    inFlight: state.inFlight,
    retryLimit: REGION_REPLICATION_RETRY_LIMIT,
    timeoutMs: REGION_REPLICATION_TIMEOUT_MS,
    configuredRegions: Object.keys(parseEndpoints()),
    stats: {
        ...state.stats,
    },
});

module.exports = {
    enqueueReplicationEvent,
    startRegionReplicationDispatcher,
    stopRegionReplicationDispatcher,
    getRegionReplicationSnapshot,
    __test__: {
        parseEndpoints,
        resolveTargetUrls,
        flushQueue,
    },
};
