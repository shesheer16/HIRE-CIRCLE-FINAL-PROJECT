jest.mock('../models/ApiKey', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/ApiAuditLog', () => ({
    create: jest.fn(),
}));

jest.mock('../config/redis', () => ({
    incr: jest.fn(),
    pExpire: jest.fn(),
}));

jest.mock('../services/externalRateLimitService', () => ({
    consumeApiRateLimit: jest.fn(),
    consumeInvalidApiKeyAttempt: jest.fn(),
    readIpAddress: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../services/externalApiKeyService', () => ({
    API_KEY_TRANSPORT: {
        none: 'none',
        header: 'header',
        query: 'query',
        body: 'body',
    },
    resolveApiKeyFromRequest: jest.fn(),
    findApiKeyByRawValue: jest.fn(),
    toRateLimitPerHour: jest.fn(() => 100),
}));

jest.mock('../services/apiBillingService', () => ({
    trackApiUsageForBilling: jest.fn(),
}));

jest.mock('../services/platformAuditService', () => ({
    appendPlatformAuditLog: jest.fn(),
}));

jest.mock('../services/widgetTokenService', () => ({
    resolveApiKeyFromWidgetToken: jest.fn(),
    resolveWidgetRequestDomain: jest.fn(() => 'partner.example.com'),
}));

const redisClient = require('../config/redis');
const { consumeApiRateLimit, consumeInvalidApiKeyAttempt } = require('../services/externalRateLimitService');
const {
    API_KEY_TRANSPORT,
    resolveApiKeyFromRequest,
    findApiKeyByRawValue,
} = require('../services/externalApiKeyService');
const { trackApiUsageForBilling } = require('../services/apiBillingService');
const { applyPublicApiGuard } = require('../middleware/publicApiV3Middleware');

const mockRes = () => {
    const res = {};
    res.statusCode = 200;
    res.status = jest.fn().mockImplementation((code) => {
        res.statusCode = code;
        return res;
    });
    res.json = jest.fn().mockReturnValue(res);
    res.on = jest.fn();
    res.setHeader = jest.fn();
    return res;
};

const makeApiKeyDoc = (overrides = {}) => ({
    _id: 'key-1',
    keyId: 'pk_test',
    ownerId: 'owner-1',
    employerId: 'owner-1',
    organization: 'org-1',
    scope: 'jobs',
    isActive: true,
    revoked: false,
    usageCount: 0,
    usageMetrics: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

describe('publicApiV3Middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: null,
            transport: API_KEY_TRANSPORT.none,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        });
        redisClient.incr.mockResolvedValue(1);
        redisClient.pExpire.mockResolvedValue(1);
        consumeApiRateLimit.mockResolvedValue({
            allowed: true,
            retryAfterMs: 0,
        });
        trackApiUsageForBilling.mockResolvedValue({
            policy: { blocked: false },
            usage: { totalCalls: 1 },
        });
    });

    it('returns 401 when API key is missing', async () => {
        const guard = applyPublicApiGuard('jobs');
        const req = { headers: {}, query: {}, body: {} };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(consumeInvalidApiKeyAttempt).toHaveBeenCalled();
    });

    it('returns 403 when scope does not allow endpoint', async () => {
        findApiKeyByRawValue.mockResolvedValue(makeApiKeyDoc({ scope: 'read-only' }));
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: 'hire_test_123',
            transport: API_KEY_TRANSPORT.header,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        });

        const guard = applyPublicApiGuard('applications');
        const req = {
            headers: { 'x-api-key': 'hire_test_123' },
            query: {},
            body: {},
        };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes valid scoped request and attaches tenant context', async () => {
        const apiKeyDoc = makeApiKeyDoc({ scope: 'jobs' });
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: 'hire_test_123',
            transport: API_KEY_TRANSPORT.header,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        });

        const guard = applyPublicApiGuard('jobs');
        const req = {
            headers: { 'x-api-key': 'hire_test_123' },
            query: {},
            body: {},
            method: 'GET',
            originalUrl: '/api/v3/public/jobs',
        };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.externalApiKey).toBe(apiKeyDoc);
        expect(req.tenantContext).toEqual({
            tenantId: 'org-1',
            ownerId: 'owner-1',
            mode: 'organization',
        });
        expect(apiKeyDoc.save).toHaveBeenCalled();
    });

    it('blocks when billing policy requires upgrade', async () => {
        const apiKeyDoc = makeApiKeyDoc({ scope: 'jobs' });
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: 'hire_test_123',
            transport: API_KEY_TRANSPORT.header,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        });
        trackApiUsageForBilling.mockResolvedValue({
            policy: {
                blocked: true,
                status: 402,
                message: 'Upgrade required',
            },
            usage: { totalCalls: 10001 },
        });

        const guard = applyPublicApiGuard('jobs');
        const req = {
            headers: { 'x-api-key': 'hire_test_123' },
            query: {},
            body: {},
        };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks legacy query transport when header-only mode is in effect', async () => {
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: null,
            transport: API_KEY_TRANSPORT.query,
            isLegacyTransport: true,
            legacyTransportBlocked: true,
        });

        const guard = applyPublicApiGuard('jobs');
        const req = {
            headers: {},
            query: { api_key: 'legacy-query-key' },
            body: {},
        };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'API key is required via the X-API-Key header' });
        expect(consumeInvalidApiKeyAttempt).not.toHaveBeenCalled();
        expect(findApiKeyByRawValue).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('adds deprecation headers when legacy query transport is still allowed', async () => {
        const apiKeyDoc = makeApiKeyDoc({ scope: 'jobs' });
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        resolveApiKeyFromRequest.mockReturnValue({
            apiKey: 'legacy-query-key',
            transport: API_KEY_TRANSPORT.query,
            isLegacyTransport: true,
            legacyTransportBlocked: false,
        });

        const guard = applyPublicApiGuard('jobs');
        const req = {
            headers: {},
            query: { api_key: 'legacy-query-key' },
            body: {},
            method: 'GET',
            originalUrl: '/api/v3/public/jobs',
        };
        const res = mockRes();
        const next = jest.fn();

        await guard(req, res, next);

        expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
        expect(res.setHeader).toHaveBeenCalledWith('X-API-Key-Transport', 'query');
        expect(next).toHaveBeenCalledTimes(1);
    });
});
