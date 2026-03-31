const logger = require('../utils/logger');

const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half_open';

const DEFAULT_CONFIG = Object.freeze({
    failureThreshold: Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
    cooldownMs: Number.parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || String(30 * 1000), 10),
    successThreshold: Number.parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10),
    timeoutMs: Number.parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS || '8000', 10),
});

class CircuitOpenError extends Error {
    constructor(message, retryAfterMs = 0, source = 'unknown') {
        super(message || 'Circuit is open');
        this.name = 'CircuitOpenError';
        this.retryAfterMs = Number(retryAfterMs || 0);
        this.source = source;
    }
}

const circuitStore = new Map();

const nowIso = () => new Date().toISOString();

const withTimeout = async (executor, timeoutMs) => {
    let timeoutHandle = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            const timeoutError = new Error(`Circuit execution timed out after ${timeoutMs}ms`);
            timeoutError.code = 'CIRCUIT_TIMEOUT';
            reject(timeoutError);
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            executor(),
            timeoutPromise,
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
};

const getOrCreateCircuit = (name, options = {}) => {
    const key = String(name || 'unnamed');
    if (!circuitStore.has(key)) {
        circuitStore.set(key, {
            name: key,
            state: STATE_CLOSED,
            failures: 0,
            consecutiveSuccesses: 0,
            openedAt: null,
            lastFailureAt: null,
            lastSuccessAt: null,
            lastError: null,
            options: {
                ...DEFAULT_CONFIG,
                ...options,
            },
        });
    } else if (options && Object.keys(options).length > 0) {
        const existing = circuitStore.get(key);
        existing.options = {
            ...existing.options,
            ...options,
        };
        circuitStore.set(key, existing);
    }

    return circuitStore.get(key);
};

const openCircuit = (circuit, reason = 'failure_threshold_exceeded') => {
    circuit.state = STATE_OPEN;
    circuit.openedAt = Date.now();
    circuit.consecutiveSuccesses = 0;

    logger.warn({
        event: 'circuit_breaker_opened',
        source: circuit.name,
        reason,
        failures: circuit.failures,
        openedAt: nowIso(),
        cooldownMs: circuit.options.cooldownMs,
    });
};

const closeCircuit = (circuit, reason = 'recovered') => {
    circuit.state = STATE_CLOSED;
    circuit.failures = 0;
    circuit.consecutiveSuccesses = 0;
    circuit.openedAt = null;

    logger.info({
        event: 'circuit_breaker_closed',
        source: circuit.name,
        reason,
        closedAt: nowIso(),
    });
};

const moveToHalfOpen = (circuit) => {
    circuit.state = STATE_HALF_OPEN;
    circuit.consecutiveSuccesses = 0;

    logger.info({
        event: 'circuit_breaker_half_open',
        source: circuit.name,
        at: nowIso(),
    });
};

const isCircuitBlocked = (circuit) => {
    if (circuit.state !== STATE_OPEN) return { blocked: false, retryAfterMs: 0 };

    const elapsed = Date.now() - Number(circuit.openedAt || 0);
    const retryAfterMs = Math.max(0, Number(circuit.options.cooldownMs || 0) - elapsed);

    if (retryAfterMs > 0) {
        return { blocked: true, retryAfterMs };
    }

    moveToHalfOpen(circuit);
    return { blocked: false, retryAfterMs: 0 };
};

const executeWithCircuitBreaker = async (name, executor, options = {}) => {
    if (typeof executor !== 'function') {
        throw new Error('Circuit breaker executor must be a function');
    }

    const circuit = getOrCreateCircuit(name, options);
    const block = isCircuitBlocked(circuit);
    if (block.blocked) {
        throw new CircuitOpenError(
            `Circuit open for ${circuit.name}`,
            block.retryAfterMs,
            circuit.name
        );
    }

    try {
        const timeoutMs = Number(options.timeoutMs || circuit.options.timeoutMs || DEFAULT_CONFIG.timeoutMs);
        const result = await withTimeout(executor, timeoutMs);

        circuit.lastSuccessAt = Date.now();
        circuit.lastError = null;

        if (circuit.state === STATE_HALF_OPEN) {
            circuit.consecutiveSuccesses += 1;
            if (circuit.consecutiveSuccesses >= Number(circuit.options.successThreshold || 1)) {
                closeCircuit(circuit, 'half_open_success_threshold_met');
            }
        } else {
            circuit.failures = 0;
        }

        return result;
    } catch (error) {
        circuit.failures += 1;
        circuit.lastFailureAt = Date.now();
        circuit.lastError = String(error?.message || error || 'unknown_error');

        const shouldOpen = circuit.state === STATE_HALF_OPEN
            || circuit.failures >= Number(circuit.options.failureThreshold || DEFAULT_CONFIG.failureThreshold);

        if (shouldOpen) {
            openCircuit(circuit, error?.code || error?.message || 'execution_failed');
        } else {
            logger.warn({
                event: 'circuit_breaker_failure',
                source: circuit.name,
                failures: circuit.failures,
                threshold: circuit.options.failureThreshold,
                message: circuit.lastError,
                at: nowIso(),
            });
        }

        throw error;
    }
};

const getCircuitState = (name) => {
    const circuit = getOrCreateCircuit(name);
    const block = isCircuitBlocked(circuit);

    return {
        name: circuit.name,
        state: circuit.state,
        failures: circuit.failures,
        consecutiveSuccesses: circuit.consecutiveSuccesses,
        lastFailureAt: circuit.lastFailureAt ? new Date(circuit.lastFailureAt).toISOString() : null,
        lastSuccessAt: circuit.lastSuccessAt ? new Date(circuit.lastSuccessAt).toISOString() : null,
        lastError: circuit.lastError,
        retryAfterMs: block.retryAfterMs,
        options: {
            failureThreshold: circuit.options.failureThreshold,
            cooldownMs: circuit.options.cooldownMs,
            successThreshold: circuit.options.successThreshold,
            timeoutMs: circuit.options.timeoutMs,
        },
    };
};

const getAllCircuitStates = () => Array.from(circuitStore.keys()).map((key) => getCircuitState(key));

module.exports = {
    CircuitOpenError,
    executeWithCircuitBreaker,
    getCircuitState,
    getAllCircuitStates,
    STATE_CLOSED,
    STATE_OPEN,
    STATE_HALF_OPEN,
};
