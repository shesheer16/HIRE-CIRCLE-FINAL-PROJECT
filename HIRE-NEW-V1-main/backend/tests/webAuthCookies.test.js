const {
    isBrowserSessionRequest,
    readRefreshTokenFromRequest,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
} = require('../utils/webAuthCookies');

describe('web auth cookies', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('detects browser session mode requests', () => {
        expect(isBrowserSessionRequest({
            headers: {
                'x-session-mode': 'browser',
            },
        })).toBe(true);

        expect(isBrowserSessionRequest({
            headers: {
                'x-session-mode': 'mobile',
            },
        })).toBe(false);
    });

    it('prefers refresh tokens from the request body', () => {
        const token = readRefreshTokenFromRequest({
            body: { refreshToken: 'body-token' },
            headers: {
                cookie: 'hireapp_refresh_token=cookie-token',
            },
        });

        expect(token).toBe('body-token');
    });

    it('reads refresh tokens from cookies when the body is empty', () => {
        const token = readRefreshTokenFromRequest({
            body: {},
            headers: {
                cookie: 'theme=light; hireapp_refresh_token=cookie-token; Path=/',
            },
        });

        expect(token).toBe('cookie-token');
    });

    it('sets and clears refresh cookies with browser-safe defaults', () => {
        process.env.NODE_ENV = 'test';
        const req = {
            secure: false,
            headers: {},
        };
        const res = {
            cookie: jest.fn(),
            clearCookie: jest.fn(),
        };

        setRefreshTokenCookie(req, res, 'refresh-token');
        clearRefreshTokenCookie(req, res);

        expect(res.cookie).toHaveBeenCalledWith(
            'hireapp_refresh_token',
            'refresh-token',
            expect.objectContaining({
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/api/users',
            })
        );

        expect(res.clearCookie).toHaveBeenCalledWith(
            'hireapp_refresh_token',
            expect.objectContaining({
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/api/users',
            })
        );
    });
});
