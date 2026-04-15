const startedAt = Date.now();

const routeStats = new Map();
const latencyBuckets = [50, 100, 250, 500, 1000, 2000, 5000];
const latencyHistogram = latencyBuckets.reduce((acc, bucket) => {
    acc[`lte_${bucket}ms`] = 0;
    return acc;
}, { gt_5000ms: 0 });

const totals = {
    requests: 0,
    errors: 0,
    slowRequests: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
};

const MAX_ROUTE_STATS = 1000;

const toRouteKey = ({ method, route, statusCode }) => `${method || 'UNKNOWN'} ${route || '/'} ${statusCode || 0}`;

const observeRequest = ({ method, route, statusCode, durationMs }) => {
    const latency = Number.isFinite(durationMs) ? durationMs : 0;
    totals.requests += 1;
    totals.totalLatencyMs += latency;
    totals.maxLatencyMs = Math.max(totals.maxLatencyMs, latency);

    if (Number(statusCode) >= 400) {
        totals.errors += 1;
    }
    if (latency >= 1000) {
        totals.slowRequests += 1;
    }

    let bucketMatched = false;
    for (const bucket of latencyBuckets) {
        if (latency <= bucket) {
            latencyHistogram[`lte_${bucket}ms`] += 1;
            bucketMatched = true;
            break;
        }
    }
    if (!bucketMatched) {
        latencyHistogram.gt_5000ms += 1;
    }

    const key = toRouteKey({ method, route, statusCode });
    const entry = routeStats.get(key) || {
        method,
        route,
        statusCode,
        count: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
    };

    entry.count += 1;
    entry.totalLatencyMs += latency;
    entry.maxLatencyMs = Math.max(entry.maxLatencyMs, latency);

    if (!routeStats.has(key) && routeStats.size >= MAX_ROUTE_STATS) {
        const oldestKey = routeStats.keys().next();
        if (!oldestKey.done) {
            routeStats.delete(oldestKey.value);
        }
    }

    routeStats.set(key, entry);
};

const getMetricsSnapshot = () => {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const avgLatencyMs = totals.requests > 0
        ? Number((totals.totalLatencyMs / totals.requests).toFixed(2))
        : 0;

    const topRoutes = Array.from(routeStats.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 50)
        .map((entry) => ({
            method: entry.method,
            route: entry.route,
            statusCode: entry.statusCode,
            count: entry.count,
            avgLatencyMs: entry.count > 0
                ? Number((entry.totalLatencyMs / entry.count).toFixed(2))
                : 0,
            maxLatencyMs: Number(entry.maxLatencyMs.toFixed(2)),
        }));

    return {
        service: 'backend',
        status: 'ok',
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds,
        totals: {
            requests: totals.requests,
            errors: totals.errors,
            slowRequests: totals.slowRequests,
            avgLatencyMs,
            maxLatencyMs: Number(totals.maxLatencyMs.toFixed(2)),
        },
        latencyHistogram,
        routes: topRoutes,
        memory: process.memoryUsage(),
    };
};

module.exports = {
    observeRequest,
    getMetricsSnapshot,
};
