jest.mock('../models/ApiKey', () => {
    const hashApiKeyValue = (value) => `hash-${value}`;
    return {
        API_SCOPES: ['read-only', 'jobs', 'applications', 'full-access'],
        RATE_LIMIT_TIERS: ['basic', 'pro', 'enterprise'],
        hashApiKeyValue,
        create: jest.fn(),
        find: jest.fn(),
    };
});

const ApiKey = require('../models/ApiKey');
const {
    API_KEY_TRANSPORT,
    allowLegacyApiKeyTransports,
    resolveApiKeyFromRequest,
    extractApiKeyFromRequest,
    normalizeScope,
    normalizeRateLimitTier,
    toRateLimitPerHour,
    createApiKey,
    findApiKeyByRawValue,
} = require('../services/externalApiKeyService');

describe('externalApiKeyService', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envSnapshot };
        delete process.env.ALLOW_LEGACY_API_KEY_TRANSPORTS;
    });

    afterAll(() => {
        process.env = envSnapshot;
    });

    it('normalizes unsupported scopes and tiers to defaults', () => {
        expect(normalizeScope('unknown')).toBe('read-only');
        expect(normalizeRateLimitTier('invalid')).toBe('basic');
    });

    it('resolves rate limits by tier', () => {
        expect(toRateLimitPerHour({ rateLimitTier: 'basic' })).toBe(100);
        expect(toRateLimitPerHour({ rateLimitTier: 'pro' })).toBe(1000);
        expect(toRateLimitPerHour({ rateLimitTier: 'enterprise', rateLimit: 7000 })).toBe(7000);
    });

    it('creates hashed API key and never stores raw key', async () => {
        ApiKey.create.mockImplementation(async (payload) => ({
            _id: 'key-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            ...payload,
        }));

        const result = await createApiKey({
            ownerId: 'owner-1',
            scope: 'jobs',
            rateLimitTier: 'pro',
            label: 'Partner Key',
        });

        expect(result.rawKey).toMatch(/^hire_/);
        expect(result.apiKey.key).toContain('hash-');
        expect(result.apiKey.key).not.toBe(result.rawKey);
        expect(ApiKey.create).toHaveBeenCalledWith(expect.objectContaining({
            key: expect.any(String),
            scope: 'jobs',
            rateLimitTier: 'pro',
        }));
    });

    it('finds hashed and legacy keys', async () => {
        ApiKey.find.mockReturnValue({
            select: jest.fn().mockResolvedValue([
            { key: 'hash-test-key', keyPattern: 'test', isActive: true },
            { key: null, keyPattern: 'legacy-key', isActive: true },
            ]),
        });

        const hashedHit = await findApiKeyByRawValue('test-key');
        expect(hashedHit).toEqual(expect.objectContaining({ key: 'hash-test-key' }));

        const legacyHit = await findApiKeyByRawValue('legacy-key');
        expect(legacyHit).toEqual(expect.objectContaining({ keyPattern: 'legacy-key' }));
    });

    it('accepts legacy query/body API key transports outside production', () => {
        process.env.NODE_ENV = 'development';

        expect(allowLegacyApiKeyTransports()).toBe(true);
        expect(extractApiKeyFromRequest({
            headers: {},
            query: { api_key: 'query-key' },
            body: {},
        })).toBe('query-key');
        expect(extractApiKeyFromRequest({
            headers: {},
            query: {},
            body: { apiKey: 'body-key' },
        })).toBe('body-key');
    });

    it('requires header transport in production by default', () => {
        process.env.NODE_ENV = 'production';

        expect(allowLegacyApiKeyTransports()).toBe(false);
        expect(extractApiKeyFromRequest({
            headers: {},
            query: { api_key: 'query-key' },
            body: { apiKey: 'body-key' },
        })).toBeNull();
        expect(extractApiKeyFromRequest({
            headers: { 'x-api-key': 'header-key' },
            query: { api_key: 'query-key' },
            body: { apiKey: 'body-key' },
        })).toBe('header-key');
    });

    it('allows legacy transports in production only when explicitly enabled', () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_LEGACY_API_KEY_TRANSPORTS = 'true';

        expect(allowLegacyApiKeyTransports()).toBe(true);
        expect(extractApiKeyFromRequest({
            headers: {},
            query: { apiKey: 'query-key' },
            body: {},
        })).toBe('query-key');
    });

    it('reports blocked legacy transport metadata when production disables query/body keys', () => {
        process.env.NODE_ENV = 'production';

        expect(resolveApiKeyFromRequest({
            headers: {},
            query: { api_key: 'query-key' },
            body: {},
        })).toEqual({
            apiKey: null,
            transport: API_KEY_TRANSPORT.query,
            isLegacyTransport: true,
            legacyTransportBlocked: true,
        });
    });

    it('prefers header transport when both header and legacy values are present', () => {
        process.env.NODE_ENV = 'production';

        expect(resolveApiKeyFromRequest({
            headers: { 'x-api-key': 'header-key' },
            query: { api_key: 'query-key' },
            body: { apiKey: 'body-key' },
        })).toEqual({
            apiKey: 'header-key',
            transport: API_KEY_TRANSPORT.header,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        });
    });
});
