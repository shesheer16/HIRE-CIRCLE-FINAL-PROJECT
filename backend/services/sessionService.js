const redisClient = require('../config/redis');

const SOCKET_KEY_PREFIX = 'session:user:sockets';
const localSocketSessions = new Map();
let ioServer = null;

const normalize = (value) => String(value || '').trim();

const canUseRedis = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.sAdd === 'function'
    && typeof redisClient.sMembers === 'function'
);

const socketKey = (userId) => `${SOCKET_KEY_PREFIX}:${normalize(userId)}`;

const setSocketIoServer = (io) => {
    ioServer = io || null;
};

const registerSocketSession = async ({ userId, socketId }) => {
    const safeUserId = normalize(userId);
    const safeSocketId = normalize(socketId);
    if (!safeUserId || !safeSocketId) return;

    const existing = localSocketSessions.get(safeUserId) || new Set();
    existing.add(safeSocketId);
    localSocketSessions.set(safeUserId, existing);

    if (!canUseRedis()) return;
    await redisClient.sAdd(socketKey(safeUserId), safeSocketId);
    await redisClient.expire(socketKey(safeUserId), 60 * 60 * 24);
};

const unregisterSocketSession = async ({ userId, socketId }) => {
    const safeUserId = normalize(userId);
    const safeSocketId = normalize(socketId);
    if (!safeUserId || !safeSocketId) return;

    const existing = localSocketSessions.get(safeUserId);
    if (existing) {
        existing.delete(safeSocketId);
        if (existing.size === 0) {
            localSocketSessions.delete(safeUserId);
        } else {
            localSocketSessions.set(safeUserId, existing);
        }
    }

    if (!canUseRedis()) return;
    await redisClient.sRem(socketKey(safeUserId), safeSocketId);
};

const getSocketIdsForUser = async (userId) => {
    const safeUserId = normalize(userId);
    if (!safeUserId) return [];
    const local = Array.from(localSocketSessions.get(safeUserId) || []);
    if (!canUseRedis()) return local;

    const remote = await redisClient.sMembers(socketKey(safeUserId));
    return Array.from(new Set([
        ...local,
        ...(Array.isArray(remote) ? remote.map((entry) => normalize(entry)).filter(Boolean) : []),
    ]));
};

const clearSocketSessionsForUser = async ({ userId, disconnect = true } = {}) => {
    const safeUserId = normalize(userId);
    if (!safeUserId) return { disconnected: 0, socketIds: [] };

    const socketIds = await getSocketIdsForUser(safeUserId);
    let disconnected = 0;

    if (disconnect && ioServer && socketIds.length) {
        socketIds.forEach((id) => {
            const socket = ioServer.sockets?.sockets?.get(id);
            if (socket) {
                socket.disconnect(true);
                disconnected += 1;
            }
        });
    }

    localSocketSessions.delete(safeUserId);
    if (canUseRedis()) {
        await redisClient.del(socketKey(safeUserId));
    }

    return {
        disconnected,
        socketIds,
    };
};

const upsertDeviceSession = ({ user, deviceId, platform = 'unknown' }) => {
    const safeDeviceId = normalize(deviceId);
    if (!user || !safeDeviceId) return false;

    const rows = Array.isArray(user.deviceSessions) ? user.deviceSessions : [];
    const existingIndex = rows.findIndex((row) => normalize(row.deviceId) === safeDeviceId);
    const nextRow = {
        deviceId: safeDeviceId,
        platform: normalize(platform) || 'unknown',
        lastSeenAt: new Date(),
        revokedAt: null,
    };

    if (existingIndex >= 0) {
        rows[existingIndex] = {
            ...rows[existingIndex],
            ...nextRow,
        };
    } else {
        rows.push(nextRow);
    }

    user.deviceSessions = rows.slice(-25);
    return true;
};

const revokeDeviceSession = ({ user, deviceId = null } = {}) => {
    if (!user) return 0;
    const rows = Array.isArray(user.deviceSessions) ? user.deviceSessions : [];
    if (!rows.length) return 0;

    const safeDeviceId = normalize(deviceId);
    let revoked = 0;
    user.deviceSessions = rows.map((row) => {
        const shouldRevoke = !safeDeviceId || normalize(row.deviceId) === safeDeviceId;
        if (!shouldRevoke || row.revokedAt) return row;
        revoked += 1;
        return {
            ...row,
            revokedAt: new Date(),
        };
    });
    return revoked;
};

module.exports = {
    setSocketIoServer,
    registerSocketSession,
    unregisterSocketSession,
    clearSocketSessionsForUser,
    upsertDeviceSession,
    revokeDeviceSession,
};
