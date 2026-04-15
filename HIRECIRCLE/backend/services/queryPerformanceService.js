const mongoose = require('mongoose');
const logger = require('../utils/logger');

const DEFAULT_SLOW_QUERY_MS = Number.parseInt(process.env.DB_SLOW_QUERY_MS || '200', 10);
const DEFAULT_QUERY_TIMEOUT_MS = Number.parseInt(process.env.DB_QUERY_TIMEOUT_MS || '5000', 10);
const DEFAULT_QUERY_MAX_TIME_MS = Number.parseInt(process.env.DB_QUERY_MAX_TIME_MS || '3000', 10);
const DEFAULT_QUERY_MAX_LIMIT = Number.parseInt(process.env.DB_QUERY_MAX_LIMIT || '1000', 10);
const DEFAULT_BULK_MAX_OPS = Number.parseInt(process.env.DB_BULK_MAX_OPS || '500', 10);

let queryMonitoringInstalled = false;
let bulkGuardInstalled = false;

const truncate = (value, max = 2000) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

const withTimeout = async (promise, timeoutMs) => {
    let timer = null;
    let timedOut = false;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            const timeoutError = new Error(`Database query timed out after ${timeoutMs}ms`);
            timeoutError.code = 'DB_QUERY_TIMEOUT';
            reject(timeoutError);
        }, timeoutMs);
    });

    // Attach a no-op catch to timeoutPromise so its rejection never leaks
    // as an unhandledRejection if the outer Promise.race already resolved.
    timeoutPromise.catch(() => { });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        return result;
    } finally {
        if (timer) clearTimeout(timer);
        // Swallow the original promise rejection if we already timed out,
        // so it doesn't surface as an additional unhandledRejection.
        if (timedOut) {
            promise.catch(() => { });
        }
    }
};

const inferIndexSuggestion = ({ operation = '', query = {}, options = {} }) => {
    const keys = Object.keys(query || {}).filter((key) => !key.startsWith('$'));
    const sortKeys = Object.keys(options?.sort || {});
    const projectionKeys = Object.keys(options?.projection || {});
    return {
        operation,
        suggestedIndexPrefix: [...keys, ...sortKeys].slice(0, 4),
        projectionCandidate: projectionKeys.slice(0, 8),
    };
};

const emitSlowQueryLog = ({
    modelName,
    operation,
    durationMs,
    query,
    options,
    pipeline,
    thresholdMs,
}) => {
    const suggestion = inferIndexSuggestion({ operation, query, options });
    logger.warn({
        event: 'slow_query',
        model: modelName,
        operation,
        durationMs: Number(durationMs.toFixed(2)),
        thresholdMs,
        query: truncate(JSON.stringify(query || {})),
        options: truncate(JSON.stringify(options || {})),
        pipeline: truncate(JSON.stringify(pipeline || [])),
        suggestion,
    });
};

const enforceQueryGuardrails = (queryInstance, { maxTimeMs = DEFAULT_QUERY_MAX_TIME_MS, maxLimit = DEFAULT_QUERY_MAX_LIMIT } = {}) => {
    const options = queryInstance.getOptions?.() || {};
    const limit = Number(options.limit || 0);

    if (Number.isFinite(limit) && limit > maxLimit) {
        const error = new Error(`Query limit ${limit} exceeds allowed maximum ${maxLimit}`);
        error.code = 'DB_QUERY_LIMIT_EXCEEDED';
        throw error;
    }

    const hasExplicitMaxTime = Number.isFinite(Number(options.maxTimeMS));
    if (!hasExplicitMaxTime && typeof queryInstance.maxTimeMS === 'function') {
        queryInstance.maxTimeMS(maxTimeMs);
    }
};

const enforceAggregateGuardrails = (aggregateInstance, { maxTimeMs = DEFAULT_QUERY_MAX_TIME_MS } = {}) => {
    const options = aggregateInstance.options || {};
    if (!Number.isFinite(Number(options.maxTimeMS))) {
        aggregateInstance.option({ maxTimeMS: maxTimeMs });
    }
};

const installQueryPerformanceMonitor = ({
    thresholdMs = DEFAULT_SLOW_QUERY_MS,
    queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
    queryMaxTimeMs = DEFAULT_QUERY_MAX_TIME_MS,
    queryMaxLimit = DEFAULT_QUERY_MAX_LIMIT,
} = {}) => {
    if (queryMonitoringInstalled) return;
    queryMonitoringInstalled = true;

    const originalQueryExec = mongoose.Query.prototype.exec;
    mongoose.Query.prototype.exec = async function patchedQueryExec(...args) {
        enforceQueryGuardrails(this, {
            maxTimeMs: queryMaxTimeMs,
            maxLimit: queryMaxLimit,
        });

        const startedAt = process.hrtime.bigint();
        try {
            return await withTimeout(
                originalQueryExec.apply(this, args),
                queryTimeoutMs
            );
        } finally {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            if (durationMs >= thresholdMs) {
                emitSlowQueryLog({
                    modelName: this?.model?.modelName || 'unknown',
                    operation: this.op || 'query',
                    durationMs,
                    query: this.getQuery?.() || {},
                    options: this.getOptions?.() || {},
                    thresholdMs,
                });
            }
        }
    };

    const originalAggregateExec = mongoose.Aggregate.prototype.exec;
    mongoose.Aggregate.prototype.exec = async function patchedAggregateExec(...args) {
        enforceAggregateGuardrails(this, { maxTimeMs: queryMaxTimeMs });

        const startedAt = process.hrtime.bigint();
        try {
            return await withTimeout(
                originalAggregateExec.apply(this, args),
                queryTimeoutMs
            );
        } finally {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            if (durationMs >= thresholdMs) {
                emitSlowQueryLog({
                    modelName: this?._model?.modelName || 'aggregate',
                    operation: 'aggregate',
                    durationMs,
                    pipeline: this.pipeline?.() || [],
                    thresholdMs,
                });
            }
        }
    };
};

const installBulkOperationGuardrails = ({ maxBulkOps = DEFAULT_BULK_MAX_OPS } = {}) => {
    if (bulkGuardInstalled) return;
    bulkGuardInstalled = true;

    const originalBulkWrite = mongoose.Model.bulkWrite;
    mongoose.Model.bulkWrite = async function patchedBulkWrite(operations = [], ...args) {
        const totalOps = Array.isArray(operations) ? operations.length : 0;
        if (totalOps > maxBulkOps) {
            const error = new Error(`Bulk operation size ${totalOps} exceeds maximum ${maxBulkOps}`);
            error.code = 'DB_BULK_LIMIT_EXCEEDED';
            logger.warn({
                event: 'bulk_operation_blocked',
                model: this?.modelName || 'unknown',
                totalOps,
                maxBulkOps,
            });
            throw error;
        }

        return originalBulkWrite.call(this, operations, ...args);
    };
};

const installDatabaseSafetyGuards = (options = {}) => {
    installQueryPerformanceMonitor(options);
    installBulkOperationGuardrails({
        maxBulkOps: Number.parseInt(process.env.DB_BULK_MAX_OPS || String(DEFAULT_BULK_MAX_OPS), 10),
    });
};

module.exports = {
    installQueryPerformanceMonitor,
    installBulkOperationGuardrails,
    installDatabaseSafetyGuards,
};
