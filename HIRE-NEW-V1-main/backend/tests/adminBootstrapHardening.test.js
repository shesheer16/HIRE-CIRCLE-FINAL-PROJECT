jest.mock('../models/AdminUser', () => ({
    countDocuments: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
}));

jest.mock('../services/adminAuthService', () => ({
    issueAdminToken: jest.fn(),
    ensureBootstrapAdmin: jest.fn(),
}));

const AdminUser = require('../models/AdminUser');
const { issueAdminToken, ensureBootstrapAdmin } = require('../services/adminAuthService');
const { bootstrapAdmin } = require('../controllers/adminAuthController');

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

describe('admin bootstrap hardening', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envSnapshot };
        delete process.env.ADMIN_BOOTSTRAP_ENABLED;
        delete process.env.ADMIN_BOOTSTRAP_TOKEN;
    });

    afterAll(() => {
        process.env = envSnapshot;
    });

    it('returns 404 when bootstrap is disabled', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_BOOTSTRAP_ENABLED = 'false';

        const req = { body: {} };
        const res = createResponse();

        await bootstrapAdmin(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(AdminUser.countDocuments).not.toHaveBeenCalled();
    });

    it('rejects production bootstrap when the bootstrap token is not configured', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ADMIN_BOOTSTRAP_ENABLED = 'true';

        const req = { body: {} };
        const res = createResponse();

        await bootstrapAdmin(req, res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(AdminUser.countDocuments).not.toHaveBeenCalled();
    });

    it('rejects production bootstrap when the bootstrap token is invalid', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ADMIN_BOOTSTRAP_ENABLED = 'true';
        process.env.ADMIN_BOOTSTRAP_TOKEN = 'expected-token';

        const req = {
            body: {},
            headers: {
                'x-bootstrap-token': 'wrong-token',
            },
        };
        const res = createResponse();

        await bootstrapAdmin(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(AdminUser.countDocuments).not.toHaveBeenCalled();
    });

    it('allows bootstrap with a valid production bootstrap token', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ADMIN_BOOTSTRAP_ENABLED = 'true';
        process.env.ADMIN_BOOTSTRAP_TOKEN = 'expected-token';

        const createdAdmin = {
            _id: 'admin-1',
            name: 'Platform Admin',
            email: 'admin@example.com',
            role: 'super_admin',
        };

        AdminUser.countDocuments.mockResolvedValue(0);
        ensureBootstrapAdmin.mockResolvedValue(null);
        AdminUser.create.mockResolvedValue(createdAdmin);
        issueAdminToken.mockReturnValue('admin-token');

        const req = {
            body: {
                name: 'Platform Admin',
                email: 'admin@example.com',
                password: 'Password123!',
            },
            headers: {
                'x-bootstrap-token': 'expected-token',
            },
        };
        const res = createResponse();

        await bootstrapAdmin(req, res);

        expect(AdminUser.countDocuments).toHaveBeenCalledTimes(1);
        expect(AdminUser.create).toHaveBeenCalledWith({
            name: 'Platform Admin',
            email: 'admin@example.com',
            password: 'Password123!',
            role: 'super_admin',
            isActive: true,
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.body.token).toBe('admin-token');
    });
});
