jest.mock('../services/externalApiKeyService', () => ({
    extractApiKeyFromRequest: jest.fn(),
    findApiKeyByRawValue: jest.fn(),
    normalizeScope: jest.fn((scope) => scope || 'read-only'),
    toRateLimitPerHour: jest.fn(() => 100),
    maskApiKey: jest.fn(() => 'masked'),
}));

jest.mock('../services/externalRateLimitService', () => ({
    readIpAddress: jest.fn(() => '127.0.0.1'),
    consumeApiRateLimit: jest.fn(),
    consumeInvalidApiKeyAttempt: jest.fn(),
    consumeReplayGuardAttempt: jest.fn(),
}));

const {
    extractApiKeyFromRequest,
    findApiKeyByRawValue,
} = require('../services/externalApiKeyService');
const {
    consumeApiRateLimit,
    consumeInvalidApiKeyAttempt,
    consumeReplayGuardAttempt,
} = require('../services/externalRateLimitService');

const {
    externalApiKeyAuth,
    externalTierRateLimit,
    externalReplayGuard,
} = require('../middleware/externalApiMiddleware');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn().mockReturnValue(res);
    return res;
};

describe('externalApiMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects when API key header is missing', async () => {
        extractApiKeyFromRequest.mockReturnValue(null);
        const req = { headers: {}, query: {}, body: {}, correlationId: 'req-1' };
        const res = mockRes();
        const next = jest.fn();

        await externalApiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks invalid key after brute-force threshold', async () => {
        extractApiKeyFromRequest.mockReturnValue('bad-key');
        findApiKeyByRawValue.mockResolvedValue(null);
        consumeInvalidApiKeyAttempt.mockResolvedValue({ allowed: false });

        const req = { headers: {}, query: {}, body: {}, correlationId: 'req-2' };
        const res = mockRes();
        const next = jest.fn();

        await externalApiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
    });

    it('attaches external context for a valid key', async () => {
        extractApiKeyFromRequest.mockReturnValue('good-key');
        findApiKeyByRawValue.mockResolvedValue({
            _id: 'key-1',
            ownerId: 'owner-1',
            scope: 'jobs',
            rateLimitTier: 'pro',
            revoked: false,
            isActive: true,
        });

        const req = { headers: {}, query: {}, body: {}, correlationId: 'req-3' };
        const res = mockRes();
        const next = jest.fn();

        await externalApiKeyAuth(req, res, next);

        expect(req.externalApiClient).toEqual(expect.objectContaining({
            apiKeyId: 'key-1',
            ownerId: 'owner-1',
            scope: 'jobs',
        }));
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('enforces tier rate limit with 429', async () => {
        consumeApiRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 30000 });

        const req = {
            externalApiKey: { _id: 'key-1', rateLimitTier: 'basic' },
            correlationId: 'req-4',
        };
        const res = mockRes();
        const next = jest.fn();

        await externalTierRateLimit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks replay attacks on non-GET requests', async () => {
        consumeReplayGuardAttempt.mockResolvedValue({ allowed: false });

        const req = {
            method: 'POST',
            headers: { 'x-idempotency-key': 'same-key' },
            externalApiKey: { _id: 'key-1' },
            correlationId: 'req-5',
        };
        const res = mockRes();
        const next = jest.fn();

        await externalReplayGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(next).not.toHaveBeenCalled();
    });
});
