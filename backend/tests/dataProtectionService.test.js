const {
    enforceJobReadProtection,
    enforcePlatformReadProtection,
    resolveExportRequestType,
    buildExportPayload,
} = require('../services/dataProtectionService');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    return res;
};

describe('dataProtectionService', () => {
    it('normalizes export request types', () => {
        expect(resolveExportRequestType('job_history_export')).toBe('job_history_export');
        expect(resolveExportRequestType('hire_history_export')).toBe('job_history_export');
        expect(resolveExportRequestType('interview_history_export')).toBe('interview_history_export');
        expect(resolveExportRequestType('anything_else')).toBe('settings_data_export');
    });

    it('builds hire history export payload with hired-only subset', () => {
        const payload = buildExportPayload({
            user: {
                _id: 'user-1',
                name: 'Lokesh',
                email: 'lokesh@example.com',
                role: 'candidate',
                primaryRole: 'worker',
                city: 'Hyderabad',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            settings: { any: true },
            jobs: [{ id: 'job-1' }],
            applications: [
                { id: 'app-1', status: 'hired' },
                { id: 'app-2', status: 'rejected' },
            ],
            requestType: 'job_history_export',
        });

        expect(payload.requestType).toBe('job_history_export');
        expect(payload.hireHistory).toEqual([{ id: 'app-1', status: 'hired' }]);
        expect(payload.applicationHistory).toHaveLength(2);
    });

    it('blocks bulk job scrape-like query params', () => {
        const req = {
            query: { limit: '250', page: '1' },
            user: { _id: 'user-1' },
            ip: '10.10.10.1',
            headers: {},
        };
        const res = makeRes();
        const next = jest.fn();

        enforceJobReadProtection(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows platform read under rate limit and sets remaining header', () => {
        const req = {
            platformClient: { apiKeyId: 'key-1' },
            ip: '10.10.10.2',
            headers: {},
            user: null,
        };
        const res = makeRes();
        const next = jest.fn();

        enforcePlatformReadProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.set).toHaveBeenCalledWith(
            'X-Platform-Read-Remaining',
            expect.any(String)
        );
    });
});
