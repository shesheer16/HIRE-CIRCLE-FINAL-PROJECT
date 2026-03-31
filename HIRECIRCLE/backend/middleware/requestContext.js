const crypto = require('crypto');
const logger = require('../utils/logger');
const { runWithRequestContext } = require('../utils/requestContext');
const { observeRequest } = require('../services/metricsRegistry');
const { resolveRoutingContext } = require('../services/regionRoutingService');
const { recordApiLatency, recordApiRequest } = require('../services/systemMonitoringService');
const { incrementErrorCounter } = require('../services/systemMonitoringService');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const SLOW_REQUEST_MS = Number.parseInt(process.env.SLOW_REQUEST_MS || '1000', 10);

const normalizeCorrelationId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (normalized.length > 128) return null;
    if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) return null;
    return normalized;
};

const requestContextMiddleware = (req, res, next) => {
    const headerCorrelationId = normalizeCorrelationId(req.headers['x-correlation-id']);
    const correlationId = headerCorrelationId || crypto.randomUUID();
    const startedAtNs = process.hrtime.bigint();
    const appVersion = String(req.headers['x-app-version'] || req.headers['x-client-version'] || process.env.APP_VERSION || 'unknown').trim();
    const region = String(req.headers['x-region'] || req.headers['x-country'] || process.env.APP_REGION || 'GLOBAL')
        .trim()
        .toUpperCase();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    runWithRequestContext({ correlationId, appVersion, region }, () => {
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
            const route = req.route?.path
                ? `${req.baseUrl || ''}${req.route.path}`
                : req.path;

            observeRequest({
                method: req.method,
                route,
                statusCode: res.statusCode,
                durationMs,
            });

            const logPayload = {
                event: 'request_complete',
                correlationId,
                requestId: correlationId,
                method: req.method,
                path: req.originalUrl,
                route,
                statusCode: res.statusCode,
                durationMs: Number(durationMs.toFixed(2)),
                latency: Number(durationMs.toFixed(2)),
                ip: req.ip,
                userId: req.user?._id ? String(req.user._id) : null,
                region: resolveRoutingContext({
                    user: req.user || null,
                    requestedRegion: req.headers['x-region'],
                }).primaryRegion,
            };

            void recordApiLatency({
                latencyMs: durationMs,
                route,
                method: req.method,
                statusCode: res.statusCode,
            }).catch(() => {});
            void recordApiRequest({
                statusCode: res.statusCode,
            }).catch(() => {});

            if (durationMs >= SLOW_REQUEST_MS) {
                logger.warn({ ...logPayload, event: 'slow_request' });
            } else {
                logger.info(logPayload);
            }

            if (res.statusCode >= 500) {
                void incrementErrorCounter({
                    route: req.originalUrl,
                    message: `HTTP ${res.statusCode}`,
                });
            }

            safeEmitEventEnvelope({
                eventType: 'API_REQUEST_COMPLETED',
                actorId: req.user?._id ? String(req.user._id) : null,
                entityId: correlationId,
                metadata: {
                    method: req.method,
                    path: req.originalUrl,
                    route,
                    statusCode: res.statusCode,
                    durationMs: Number(durationMs.toFixed(2)),
                },
                timestampUTC: new Date(),
                region,
                appVersion,
                source: 'request_context',
            });
        });

        next();
    });
};

module.exports = {
    requestContextMiddleware,
};
