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
    normalizeScope,
    normalizeRateLimitTier,
    toRateLimitPerHour,
    createApiKey,
    findApiKeyByRawValue,
} = require('../services/externalApiKeyService');

describe('externalApiKeyService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
});
