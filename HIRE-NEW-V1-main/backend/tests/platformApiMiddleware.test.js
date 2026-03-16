jest.mock('../models/AnalyticsEvent', () => ({
    create: jest.fn(),
}));

jest.mock('../services/externalApiKeyService', () => ({
    extractApiKeyFromRequest: jest.fn(),
    findApiKeyByRawValue: jest.fn(),
    toRateLimitPerHour: jest.fn(),
}));

jest.mock('../services/widgetTokenService', () => ({
    resolveApiKeyFromWidgetToken: jest.fn(),
    resolveWidgetRequestDomain: jest.fn(() => 'partner.example.com'),
}));

const AnalyticsEvent = require('../models/AnalyticsEvent');
const {
    extractApiKeyFromRequest,
    findApiKeyByRawValue,
    toRateLimitPerHour,
} = require('../services/externalApiKeyService');
const {
    resolveApiKeyFromWidgetToken,
} = require('../services/widgetTokenService');
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
        extractApiKeyFromRequest.mockImplementation((req) => req?.headers?.['x-api-key'] || null);
        resolveApiKeyFromWidgetToken.mockResolvedValue({
            apiKeyDoc: null,
            tokenPayload: null,
        });
    });

    it('blocks requests when API key is missing', async () => {
        const req = { headers: {}, query: {}, body: {} };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('does not accept query-string API keys when the shared extractor rejects them', async () => {
        extractApiKeyFromRequest.mockReturnValue(null);

        const req = { headers: {}, query: { api_key: 'query-key' }, body: {} };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(findApiKeyByRawValue).not.toHaveBeenCalled();
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

    it('accepts valid widget token auth for embedded platform requests', async () => {
        extractApiKeyFromRequest.mockReturnValue(null);

        const save = jest.fn().mockResolvedValue(undefined);
        const apiKeyDoc = {
            _id: 'key-4',
            key: 'embedded-key',
            keyPattern: 'embedded-key',
            isActive: true,
            organization: 'org-1',
            employerId: 'emp-1',
            allowedDomains: ['partner.example.com'],
            requestsToday: 0,
            usageCount: 2,
            planType: 'partner',
            rateLimit: 500,
            lastResetDate: new Date(),
            save,
        };
        resolveApiKeyFromWidgetToken.mockResolvedValue({
            apiKeyDoc,
            tokenPayload: {
                sub: 'key-4',
                allowedDomain: 'partner.example.com',
            },
        });
        toRateLimitPerHour.mockReturnValue(500);

        const req = {
            headers: {
                'x-widget-token': 'signed-widget-token',
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

        expect(resolveApiKeyFromWidgetToken).toHaveBeenCalledWith({
            token: 'signed-widget-token',
            requestDomain: 'partner.example.com',
        });
        expect(req.platformClient).toEqual(expect.objectContaining({
            apiKeyId: 'key-4',
            authSource: 'widget_token',
        }));
        expect(req.widgetTokenPayload).toEqual(expect.objectContaining({
            sub: 'key-4',
        }));
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not require origin allowlist headers for iframe widget sessions', async () => {
        extractApiKeyFromRequest.mockReturnValue(null);

        const save = jest.fn().mockResolvedValue(undefined);
        const apiKeyDoc = {
            _id: 'key-5',
            key: 'embedded-key',
            keyPattern: 'embedded-key',
            isActive: true,
            organization: 'org-1',
            employerId: 'emp-1',
            allowedDomains: ['partner.example.com'],
            requestsToday: 0,
            usageCount: 2,
            planType: 'partner',
            rateLimit: 500,
            lastResetDate: new Date(),
            save,
        };
        resolveApiKeyFromWidgetToken.mockResolvedValue({
            apiKeyDoc,
            tokenPayload: {
                sub: 'key-5',
                allowedDomain: null,
            },
        });
        toRateLimitPerHour.mockReturnValue(500);

        const req = {
            headers: {
                'x-widget-token': 'iframe-session-token',
            },
            query: {},
            body: {},
            method: 'POST',
            originalUrl: '/api/platform/predict-fill',
        };
        const res = mockRes();
        const next = jest.fn();

        await platformApiKeyGuard(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});
