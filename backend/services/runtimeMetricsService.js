const os = require('os');
const redisClient = require('../config/redis');

const ACTIVE_CONNECTIONS_KEY = 'metrics:active_connections';
const ACTIVE_USERS_KEY = 'metrics:active_users';
const SOCKET_USER_KEY_PREFIX = 'metrics:socket_user';

let localActiveConnections = 0;
const localActiveUsers = new Set();

const canUseRedis = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.incr === 'function'
    && typeof redisClient.sAdd === 'function'
);

const normalize = (value) => String(value || '').trim();

const markSocketConnected = async ({ socketId, userId }) => {
    localActiveConnections += 1;
    if (userId) localActiveUsers.add(normalize(userId));

    if (!canUseRedis()) return;

    const safeSocketId = normalize(socketId);
    const safeUserId = normalize(userId);
    if (!safeSocketId) return;

    await redisClient.incr(ACTIVE_CONNECTIONS_KEY);
    if (safeUserId) {
        await redisClient.set(`${SOCKET_USER_KEY_PREFIX}:${safeSocketId}`, safeUserId, { EX: 300 });
        await redisClient.sAdd(ACTIVE_USERS_KEY, safeUserId);
    }
};

const markSocketDisconnected = async ({ socketId, userId }) => {
    localActiveConnections = Math.max(0, localActiveConnections - 1);
    if (userId) {
        localActiveUsers.delete(normalize(userId));
    }

    if (!canUseRedis()) return;

    const safeSocketId = normalize(socketId);
    let resolvedUserId = normalize(userId);
    if (!resolvedUserId && safeSocketId) {
        resolvedUserId = normalize(await redisClient.get(`${SOCKET_USER_KEY_PREFIX}:${safeSocketId}`));
    }

    if (safeSocketId) {
        await redisClient.del(`${SOCKET_USER_KEY_PREFIX}:${safeSocketId}`);
    }

    const current = Number(await redisClient.decr(ACTIVE_CONNECTIONS_KEY));
    if (current < 0) {
        await redisClient.set(ACTIVE_CONNECTIONS_KEY, '0');
    }

    if (resolvedUserId) {
        const stillConnected = await redisClient.keys(`${SOCKET_USER_KEY_PREFIX}:*`);
        if (!stillConnected.length) {
            await redisClient.sRem(ACTIVE_USERS_KEY, resolvedUserId);
            return;
        }

        let userStillConnected = false;
        for (const key of stillConnected) {
            const candidateUser = await redisClient.get(key);
            if (normalize(candidateUser) === resolvedUserId) {
                userStillConnected = true;
                break;
            }
        }
        if (!userStillConnected) {
            await redisClient.sRem(ACTIVE_USERS_KEY, resolvedUserId);
        }
    }
};

const getActiveConnections = async () => {
    if (!canUseRedis()) return localActiveConnections;
    const value = Number(await redisClient.get(ACTIVE_CONNECTIONS_KEY));
    return Number.isFinite(value) && value >= 0 ? value : 0;
};

const getActiveUsers = async () => {
    if (!canUseRedis()) return localActiveUsers.size;
    return await redisClient.sCard(ACTIVE_USERS_KEY);
};

const getRuntimeSystemMetrics = async () => {
    const [activeConnections, activeUsers] = await Promise.all([
        getActiveConnections(),
        getActiveUsers(),
    ]);

    return {
        activeConnections,
        activeUsers,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        cpuLoad: os.loadavg(),
    };
};

module.exports = {
    markSocketConnected,
    markSocketDisconnected,
    getActiveConnections,
    getActiveUsers,
    getRuntimeSystemMetrics,
};
