jest.mock('../models/AnalyticsEvent', () => ({
    create: jest.fn(),
}));

jest.mock('../services/externalApiKeyService', () => ({
    findApiKeyByRawValue: jest.fn(),
    toRateLimitPerHour: jest.fn(),
}));

const AnalyticsEvent = require('../models/AnalyticsEvent');
const { findApiKeyByRawValue, toRateLimitPerHour } = require('../services/externalApiKeyService');
const {
    platformApiKeyGuard,
} = require('../middleware/platformApiMiddleware');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

describe('platformApiMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        AnalyticsEvent.create.mockResolvedValue({});
    });

    it('blocks requests when API key is missing', async () => {
        const req = { headers: {}, query: {}, body: {} };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks requests when origin is outside API key allowlist', async () => {
        const apiKeyDoc = {
            _id: 'key-1',
            key: 'test-key',
            keyPattern: 'test-key',
            isActive: true,
            allowedDomains: ['allowed.example.com'],
            requestsToday: 0,
            usageCount: 0,
            planType: 'free',
            rateLimit: 100,
            save: jest.fn(),
        };
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        toRateLimitPerHour.mockReturnValue(100);

        const req = {
            headers: { 'x-api-key': 'test-key', origin: 'https://blocked.example.com' },
            query: {},
            body: {},
        };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('enforces API key rate limit', async () => {
        const apiKeyDoc = {
            _id: 'key-2',
            key: 'rate-key',
            keyPattern: 'rate-key',
            isActive: true,
            allowedDomains: [],
            requestsToday: 100,
            usageCount: 250,
            planType: 'partner',
            rateLimit: 100,
            lastResetDate: new Date(),
            save: jest.fn(),
        };
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        toRateLimitPerHour.mockReturnValue(100);

        const req = {
            headers: { 'x-api-key': 'rate-key' },
            query: {},
            body: {},
        };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
    });

    it('accepts valid key, updates usage, and attaches platform client context', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        const apiKeyDoc = {
            _id: 'key-3',
            key: 'ok-key',
            keyPattern: 'ok-key',
            isActive: true,
            organization: 'org-1',
            employerId: 'emp-1',
            allowedDomains: ['partner.example.com'],
            requestsToday: 2,
            usageCount: 5,
            planType: 'partner',
            rateLimit: 500,
            lastResetDate: new Date(),
            save,
        };
        findApiKeyByRawValue.mockResolvedValue(apiKeyDoc);
        toRateLimitPerHour.mockReturnValue(500);

        const req = {
            headers: {
                'x-api-key': 'ok-key',
                origin: 'https://partner.example.com',
            },
            query: {},
            body: {},
            method: 'POST',
            originalUrl: '/api/platform/match',
        };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(save).toHaveBeenCalledTimes(1);
        expect(req.platformClient).toEqual(expect.objectContaining({
            apiKeyId: 'key-3',
            planType: 'partner',
            organization: 'org-1',
            employerId: 'emp-1',
        }));
        expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://partner.example.com');
        expect(next).toHaveBeenCalledTimes(1);
    });
});
