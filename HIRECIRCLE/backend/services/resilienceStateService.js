const state = {
    cpuUsagePercent: 0,
    memoryUsagePercent: 0,
    eventLoopDelayMs: 0,
    queueDepth: 0,
    queueBackpressureActive: false,
    highLoadActive: false,
    loadScore: 0,
    activeRequests: 0,
    socketConnections: 0,
    workerHealthy: true,
    lastUpdatedAt: null,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const recalculateLoad = () => {
    const cpuScore = clamp(Number(state.cpuUsagePercent || 0), 0, 100);
    const memoryScore = clamp(Number(state.memoryUsagePercent || 0), 0, 100);
    const eventLoopScore = clamp((Number(state.eventLoopDelayMs || 0) / 10), 0, 100);
    const queueScore = clamp((Number(state.queueDepth || 0) / 100), 0, 100);

    state.loadScore = Number(((cpuScore * 0.35) + (memoryScore * 0.3) + (eventLoopScore * 0.2) + (queueScore * 0.15)).toFixed(2));
    state.highLoadActive = state.loadScore >= Number.parseInt(process.env.SYSTEM_LOAD_HIGH_SCORE || '75', 10);
    state.lastUpdatedAt = new Date().toISOString();
};

const updateResilienceState = (patch = {}) => {
    Object.entries(patch || {}).forEach(([key, value]) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
            state[key] = value;
        }
    });
    recalculateLoad();
};

const getResilienceState = () => ({
    ...state,
});

module.exports = {
    updateResilienceState,
    getResilienceState,
};
