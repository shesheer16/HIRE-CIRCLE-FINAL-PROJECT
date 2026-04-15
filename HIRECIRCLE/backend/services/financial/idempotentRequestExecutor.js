const {
    beginIdempotentRequest,
    finalizeIdempotentRequest,
    clearIdempotentLock,
} = require('./idempotencyService');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:._-]{8,128}$/;

const getIdempotencyKeyFromRequest = (req) => String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim() || null;

const validateIdempotencyKey = (key, { required = false } = {}) => {
    if (!key) {
        if (!required) return null;
        const error = new Error('Idempotency key is required');
        error.statusCode = 400;
        throw error;
    }

    if (!IDEMPOTENCY_KEY_PATTERN.test(String(key))) {
        const error = new Error('Invalid idempotency key format');
        error.statusCode = 400;
        throw error;
    }

    return String(key);
};

const executeIdempotent = async ({ req, scope, payload, handler, requireKey = false }) => {
    const idempotencyKey = getIdempotencyKeyFromRequest(req);
    const validatedKey = validateIdempotencyKey(idempotencyKey, { required: requireKey });

    const ctx = await beginIdempotentRequest({
        key: validatedKey,
        scope,
        userId: req.user._id,
        payload,
    });

    if (ctx.mode === 'replay') {
        return {
            replayed: true,
            statusCode: ctx.replayResponse.statusCode,
            body: ctx.replayResponse.body,
        };
    }

    try {
        const result = await handler({
            idempotencyKey: validatedKey,
            requestHash: ctx.requestHash,
        });

        if (ctx.mode === 'active') {
            await finalizeIdempotentRequest({
                record: ctx.record,
                statusCode: 200,
                body: result,
            });
        }

        return {
            replayed: false,
            statusCode: 200,
            body: result,
        };
    } catch (error) {
        if (ctx.mode === 'active') {
            await clearIdempotentLock({ record: ctx.record });
        }
        throw error;
    }
};

module.exports = {
    executeIdempotent,
};
