jest.mock('../models/ApiKey', () => ({
    findOne: jest.fn(),
}));

jest.mock('../services/widgetTokenService', () => ({
    SESSION_TOKEN_TTL_SECONDS: 300,
    createWidgetSessionToken: jest.fn(),
    createWidgetToken: jest.fn(),
    resolveApiKeyFromWidgetToken: jest.fn(),
    resolveWidgetRequestDomain: jest.fn(),
}));

const ApiKey = require('../models/ApiKey');
const {
    createWidgetSessionToken,
    createWidgetToken,
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
} = require('../services/widgetTokenService');
const {
    bootstrapWidgetSessionController,
    createWidgetSessionTokenController,
} = require('../controllers/widgetController');

const createRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

describe('widgetController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        createWidgetToken.mockReturnValue('signed-widget-token');
        createWidgetSessionToken.mockReturnValue('session-token');
        resolveWidgetRequestDomain.mockReturnValue('partner.example.com');
    });

    it('returns clean embed URLs plus bootstrap-backed embed snippets for employers', async () => {
        ApiKey.findOne.mockResolvedValue({
            _id: 'key-1',
            ownerId: 'owner-1',
            isActive: true,
            revoked: false,
            allowedDomains: ['partner.example.com'],
        });

        const req = {
            body: {
                apiKeyId: 'key-1',
                allowedDomain: 'partner.example.com',
                baseUrl: 'https://api.hire.example',
                ttlSeconds: 900,
            },
            protocol: 'https',
            get: jest.fn((header) => (header === 'host' ? 'api.hire.example' : '')),
            user: {
                _id: 'owner-1',
                organizationId: 'org-1',
            },
        };
        const res = createRes();

        await createWidgetSessionTokenController(req, res);

        expect(createWidgetToken).toHaveBeenCalledWith(expect.objectContaining({
            apiKeyId: 'key-1',
            allowedDomain: 'partner.example.com',
            ttlSeconds: 900,
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                token: 'signed-widget-token',
                scriptUrl: 'https://api.hire.example/embed/hire-widget.js',
                bootstrapUrl: 'https://api.hire.example/embed/widget-bootstrap',
                matchWidgetUrl: 'https://api.hire.example/embed/match-widget',
                previewUrl: 'https://api.hire.example/embed/match-widget',
                embedCode: expect.stringContaining('data-hire-widget-token="signed-widget-token"'),
                iframeCode: expect.stringContaining('/embed/widget-bootstrap'),
            }),
        }));
    });

    it('bootstraps a short-lived widget session token from a verified widget token', async () => {
        resolveApiKeyFromWidgetToken.mockResolvedValue({
            apiKeyDoc: {
                _id: 'key-2',
                ownerId: 'owner-1',
                employerId: 'owner-1',
                organization: 'org-1',
            },
            tokenPayload: {
                ownerId: 'owner-1',
                tenantId: 'org-1',
            },
        });

        const req = {
            body: { token: 'signed-widget-token' },
            headers: {},
            query: {},
        };
        const res = createRes();

        await bootstrapWidgetSessionController(req, res);

        expect(resolveApiKeyFromWidgetToken).toHaveBeenCalledWith({
            token: 'signed-widget-token',
            requestDomain: 'partner.example.com',
        });
        expect(createWidgetSessionToken).toHaveBeenCalledWith({
            apiKeyId: 'key-2',
            ownerId: 'owner-1',
            tenantId: 'org-1',
        });
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: {
                sessionToken: 'session-token',
                expiresInSeconds: 300,
            },
        });
    });
});
