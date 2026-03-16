jest.mock('../models/AdminUser', () => ({
    findById: jest.fn(),
}));

jest.mock('../services/adminAuthService', () => ({
    verifyAdminToken: jest.fn(),
}));

const AdminUser = require('../models/AdminUser');
const { verifyAdminToken } = require('../services/adminAuthService');
const { requireOperationalAccess } = require('../middleware/operationalAccessMiddleware');

const createResponse = () => {
    const res = {};
    res.status = jest.fn((code) => {
        res.statusCode = code;
        return res;
    });
    res.json = jest.fn((payload) => {
        res.body = payload;
        return res;
    });
    return res;
};

describe('operational access middleware', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envSnapshot };
        delete process.env.OPS_ACCESS_TOKEN;
    });

    afterAll(() => {
        process.env = envSnapshot;
    });

    it('allows operational endpoints outside production', async () => {
        process.env.NODE_ENV = 'test';
        const req = { headers: {} };
        const res = createResponse();
        const next = jest.fn();

        await requireOperationalAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('allows production access with a matching ops token', async () => {
        process.env.NODE_ENV = 'production';
        process.env.OPS_ACCESS_TOKEN = 'ops-token';
        const req = { headers: { 'x-ops-token': 'ops-token' } };
        const res = createResponse();
        const next = jest.fn();

        await requireOperationalAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('allows production access with a valid admin bearer token', async () => {
        process.env.NODE_ENV = 'production';
        verifyAdminToken.mockReturnValue({
            adminId: 'admin-1',
            scope: 'admin_control',
        });
        AdminUser.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue({ _id: 'admin-1', isActive: true }),
        });

        const req = {
            headers: {
                authorization: 'Bearer admin-token',
            },
        };
        const res = createResponse();
        const next = jest.fn();

        await requireOperationalAccess(req, res, next);

        expect(verifyAdminToken).toHaveBeenCalledWith('admin-token');
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for unauthorized production access', async () => {
        process.env.NODE_ENV = 'production';
        verifyAdminToken.mockImplementation(() => {
            throw new Error('invalid');
        });

        const req = { headers: {} };
        const res = createResponse();
        const next = jest.fn();

        await requireOperationalAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.body).toEqual({ message: 'Not found' });
    });
});
