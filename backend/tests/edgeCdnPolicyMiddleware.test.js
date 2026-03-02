jest.mock('../services/regionRoutingService', () => ({
    resolveRoutingContext: jest.fn(() => ({
        primaryRegion: 'ap-south-1',
        failoverRegions: ['ap-southeast-1'],
        readReplicaEnabled: true,
    })),
}));

jest.mock('../config/region', () => ({
    resolveRegionConfig: jest.fn(() => ({
        staticAssetsBaseUrl: 'https://cdn.hire.example',
    })),
}));

const { edgeCdnPolicyMiddleware } = require('../middleware/edgeCdnPolicyMiddleware');

const makeRes = () => {
    const headers = {};
    return {
        setHeader: jest.fn((name, value) => {
            headers[String(name || '').toLowerCase()] = value;
        }),
        getHeader: jest.fn((name) => headers[String(name || '').toLowerCase()] || undefined),
    };
};

describe('edgeCdnPolicyMiddleware', () => {
    it('sets edge headers and public cache policy for public jobs listing', () => {
        const req = {
            method: 'GET',
            originalUrl: '/api/v3/public/jobs?page=1',
            path: '/api/v3/public/jobs',
            headers: { 'x-region': 'ap-south-1' },
            user: null,
        };
        const res = makeRes();
        const next = jest.fn();

        edgeCdnPolicyMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.edgeContext).toEqual(expect.objectContaining({
            primaryRegion: 'ap-south-1',
            failoverRegions: ['ap-southeast-1'],
            cdnEnabled: true,
        }));
        expect(res.setHeader).toHaveBeenCalledWith('x-hire-primary-region', 'ap-south-1');
        expect(res.setHeader).toHaveBeenCalledWith('x-hire-cdn-enabled', '1');
        expect(res.setHeader).toHaveBeenCalledWith(
            'cache-control',
            expect.stringContaining('s-maxage')
        );
    });

    it('does not force public cache headers on private/admin paths', () => {
        const req = {
            method: 'GET',
            originalUrl: '/api/admin/platform/keys',
            path: '/api/admin/platform/keys',
            headers: { 'x-region': 'us-east-1' },
            user: null,
        };
        const res = makeRes();
        const next = jest.fn();

        edgeCdnPolicyMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.setHeader).not.toHaveBeenCalledWith(
            'cache-control',
            expect.any(String)
        );
    });
});
