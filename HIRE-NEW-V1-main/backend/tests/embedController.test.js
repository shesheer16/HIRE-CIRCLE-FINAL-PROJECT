jest.mock('../services/externalApiKeyService', () => ({
    findApiKeyByRawValue: jest.fn(),
}));

jest.mock('../services/widgetTokenService', () => ({
    createWidgetSessionToken: jest.fn(),
    normalizeHost: jest.fn((value = '') => {
        const input = String(value || '').trim().toLowerCase();
        return input.replace(/^https?:\/\//, '').split('/')[0];
    }),
    resolveApiKeyFromWidgetToken: jest.fn(),
    resolveWidgetRequestDomain: jest.fn(),
}));

const { findApiKeyByRawValue } = require('../services/externalApiKeyService');
const {
    createWidgetSessionToken,
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
} = require('../services/widgetTokenService');
const { renderMatchWidget } = require('../controllers/embedController');

const createRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

describe('embedController', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envSnapshot };
        delete process.env.ALLOW_LEGACY_EMBED_API_KEY_QUERY;

        resolveWidgetRequestDomain.mockReturnValue('partner.example.com');
        createWidgetSessionToken.mockReturnValue('session-token');
    });

    afterAll(() => {
        process.env = envSnapshot;
    });

    it('serves a clean bootstrap-ready match widget page by default', async () => {
        const req = {
            query: {},
            get: jest.fn(() => ''),
        };
        const res = createRes();

        await renderMatchWidget(req, res);

        expect(res.set).toHaveBeenCalledWith('X-Embed-Auth-Source', 'bootstrap_pending');
        const html = res.send.mock.calls[0][0];
        expect(html).toContain('Waiting for secure widget session...');
        expect(html).toContain('window.name');
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('converts legacy widget-token URLs into short-lived session tokens for compatibility', async () => {
        resolveApiKeyFromWidgetToken.mockResolvedValue({
            apiKeyDoc: {
                _id: 'key-1',
                ownerId: 'owner-1',
                organization: 'org-1',
                isActive: true,
                revoked: false,
                planType: 'partner',
                allowedDomains: ['partner.example.com'],
            },
        });

        const req = {
            query: { token: 'legacy-widget-token' },
            get: jest.fn((header) => {
                if (header === 'referer') return 'https://partner.example.com/widget';
                if (header === 'origin') return '';
                return '';
            }),
        };
        const res = createRes();

        await renderMatchWidget(req, res);

        expect(resolveApiKeyFromWidgetToken).toHaveBeenCalledWith({
            token: 'legacy-widget-token',
            requestDomain: 'partner.example.com',
        });
        expect(createWidgetSessionToken).toHaveBeenCalledWith({
            apiKeyId: 'key-1',
            ownerId: 'owner-1',
            tenantId: 'org-1',
        });
        expect(res.set).toHaveBeenCalledWith('X-Embed-Auth-Source', 'legacy_widget_token_query');
        const html = res.send.mock.calls[0][0];
        expect(html).toContain('let sessionToken = "session-token"');
        expect(html).not.toContain('legacy-widget-token');
    });

    it('blocks legacy apiKey embed URLs in production by default', async () => {
        process.env.NODE_ENV = 'production';

        const req = {
            query: { apiKey: 'legacy-key' },
            get: jest.fn(() => ''),
        };
        const res = createRes();

        await renderMatchWidget(req, res);

        expect(findApiKeyByRawValue).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.send).toHaveBeenCalledWith('Widget token is required via the bootstrap-backed embed flow');
    });

    it('allows legacy apiKey embed URLs only in compatibility mode and converts them to session tokens', async () => {
        process.env.NODE_ENV = 'development';
        findApiKeyByRawValue.mockResolvedValue({
            _id: 'key-2',
            ownerId: 'owner-1',
            organization: 'org-1',
            isActive: true,
            revoked: false,
            planType: 'free',
            allowedDomains: ['partner.example.com'],
        });

        const req = {
            query: { apiKey: 'legacy-key' },
            get: jest.fn((header) => {
                if (header === 'referer') return 'https://partner.example.com/widget';
                if (header === 'origin') return '';
                return '';
            }),
        };
        const res = createRes();

        await renderMatchWidget(req, res);

        expect(createWidgetSessionToken).toHaveBeenCalledWith({
            apiKeyId: 'key-2',
            ownerId: 'owner-1',
            tenantId: 'org-1',
        });
        expect(res.set).toHaveBeenCalledWith('Deprecation', 'true');
        expect(res.set).toHaveBeenCalledWith('X-Embed-Auth-Source', 'legacy_api_key_query');
        const html = res.send.mock.calls[0][0];
        expect(html).toContain('let sessionToken = "session-token"');
        expect(html).not.toContain('legacy-key');
    });
});
