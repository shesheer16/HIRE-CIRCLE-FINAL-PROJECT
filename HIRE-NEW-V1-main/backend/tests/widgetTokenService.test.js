jest.mock('../models/ApiKey', () => ({
    findOne: jest.fn(),
}));

const ApiKey = require('../models/ApiKey');
const {
    createWidgetToken,
    resolveApiKeyFromWidgetToken,
    verifyWidgetToken,
} = require('../services/widgetTokenService');

describe('widgetTokenService', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...envSnapshot,
            WIDGET_TOKEN_SECRET: 'widget-test-secret',
        };
    });

    afterAll(() => {
        process.env = envSnapshot;
    });

    it('requires a request domain when token is scoped to an allowed domain', () => {
        const token = createWidgetToken({
            apiKeyId: 'key-1',
            allowedDomain: 'partner.example.com',
            ttlSeconds: 300,
        });

        expect(() => verifyWidgetToken({ token })).toThrow('Widget token domain required');
        expect(() => verifyWidgetToken({
            token,
            requestDomain: 'preview.partner.example.com',
        })).not.toThrow();
    });

    it('resolves the backing API key from a valid widget token', async () => {
        ApiKey.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                _id: 'key-1',
                isActive: true,
                revoked: false,
            }),
        });

        const token = createWidgetToken({
            apiKeyId: 'key-1',
            ownerId: 'owner-1',
            allowedDomain: 'partner.example.com',
            ttlSeconds: 300,
        });

        const result = await resolveApiKeyFromWidgetToken({
            token,
            requestDomain: 'partner.example.com',
        });

        expect(result.tokenPayload).toEqual(expect.objectContaining({
            sub: 'key-1',
            ownerId: 'owner-1',
            allowedDomain: 'partner.example.com',
        }));
        expect(result.apiKeyDoc).toEqual(expect.objectContaining({
            _id: 'key-1',
        }));
    });
});
