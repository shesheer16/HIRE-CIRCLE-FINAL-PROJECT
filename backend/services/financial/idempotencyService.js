const crypto = require('crypto');
const IdempotencyKey = require('../../models/IdempotencyKey');

const LOCK_TTL_MS = Number.parseInt(process.env.PAYMENT_IDEMPOTENCY_LOCK_MS || String(5 * 60 * 1000), 10);

const hashPayload = (payload = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex');

const buildCompositeKey = ({ scope, userId, key }) => `${String(scope || '').trim()}::${String(userId || '').trim()}::${String(key || '').trim()}`;

const beginIdempotentRequest = async ({ key, scope, userId, payload }) => {
    if (!key) {
        return {
            mode: 'none',
            record: null,
        };
    }

    const requestHash = hashPayload(payload);
    const compositeKey = buildCompositeKey({ scope, userId, key });
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);

    const existing = await IdempotencyKey.findOne({ compositeKey });
    if (existing) {
        if (existing.requestHash !== requestHash) {
            const error = new Error('Idempotency key reuse with mismatched payload');
            error.statusCode = 409;
            throw error;
        }

        if (existing.responseBody !== null && existing.responseStatus !== null) {
            return {
                mode: 'replay',
                replayResponse: {
                    statusCode: existing.responseStatus,
                    body: existing.responseBody,
                },
                record: existing,
            };
        }

        if (existing.lockedUntil && existing.lockedUntil > now) {
            const error = new Error('Request with this idempotency key is currently processing');
            error.statusCode = 409;
            throw error;
        }

        existing.lockedUntil = lockUntil;
        await existing.save();
        return {
            mode: 'active',
            record: existing,
        };
    }

    const created = await IdempotencyKey.create({
        compositeKey,
        key,
        scope,
        userId,
        requestHash,
        lockedUntil: lockUntil,
    });

    return {
        mode: 'active',
        record: created,
    };
};

const finalizeIdempotentRequest = async ({ record, statusCode, body }) => {
    if (!record) return;

    record.responseStatus = statusCode;
    record.responseBody = body;
    record.lockedUntil = null;
    await record.save();
};

const clearIdempotentLock = async ({ record }) => {
    if (!record) return;
    record.lockedUntil = null;
    await record.save();
};

module.exports = {
    beginIdempotentRequest,
    finalizeIdempotentRequest,
    clearIdempotentLock,
};
