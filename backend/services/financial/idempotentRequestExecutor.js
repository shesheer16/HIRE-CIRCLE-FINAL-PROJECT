const {
    beginIdempotentRequest,
    finalizeIdempotentRequest,
    clearIdempotentLock,
} = require('./idempotencyService');

const getIdempotencyKeyFromRequest = (req) => String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim() || null;

const executeIdempotent = async ({ req, scope, payload, handler }) => {
    const idempotencyKey = getIdempotencyKeyFromRequest(req);

    const ctx = await beginIdempotentRequest({
        key: idempotencyKey,
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
        const result = await handler({ idempotencyKey });

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
