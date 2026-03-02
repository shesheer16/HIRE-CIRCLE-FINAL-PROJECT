jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { _id: req.headers['x-user-id'] };
        next();
    },
}));

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/EmployerProfile', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    countDocuments: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/Application', () => ({
    findOne: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/RevenueEvent', () => ({
    aggregate: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/Notification', () => ({
    create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/legalConfigService', () => ({
    getLegalConfigForCountry: jest.fn().mockResolvedValue({
        country: 'IN',
        termsURL: 'https://hirecircle.com/in/legal/terms',
        privacyURL: 'https://hirecircle.com/in/legal/privacy',
        complianceFlags: ['DPDP_INDIA'],
    }),
}));
jest.mock('../services/regionFeatureFlagService', () => ({
    isRegionFeatureEnabled: jest.fn().mockResolvedValue(true),
}));

const fs = require('fs/promises');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const RevenueEvent = require('../models/RevenueEvent');
const { isRegionFeatureEnabled } = require('../services/regionFeatureFlagService');
const settingsRoutes = require('../routes/settingsRoutes');

const buildUserDoc = ({ id, role = 'candidate' }) => {
    const exportRequests = [];
    exportRequests.push = function pushWithId(item) {
        const row = { _id: `exp-${this.length + 1}`, ...item };
        return Array.prototype.push.call(this, row);
    };

    const userDoc = {
        _id: id,
        name: role === 'candidate' ? 'Candidate User' : 'Recruiter User',
        email: `${id}@example.com`,
        role,
        primaryRole: role === 'candidate' ? 'worker' : 'employer',
        city: 'Hyderabad',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        notificationPreferences: { pushEnabled: true },
        privacyPreferences: { profileVisibleToEmployers: true },
        linkedAccounts: { emailPassword: true },
        securitySettings: { twoFactorEnabled: false, twoFactorMethod: 'email' },
        subscription: { plan: 'free', credits: 3, billingPeriod: 'none' },
        exportRequests,
        save: jest.fn().mockResolvedValue(undefined),
    };

    const persistedDoc = {
        _id: id,
        exportRequests: [],
        save: jest.fn().mockResolvedValue(undefined),
    };
    persistedDoc.exportRequests.id = (requestId) => persistedDoc.exportRequests.find((row) => String(row._id) === String(requestId));

    return { userDoc, persistedDoc };
};

const readExportPayloadFromMockWrite = () => {
    const payloadText = fs.writeFile.mock.calls[0][1];
    return JSON.parse(payloadText);
};

const invokeDataDownload = async (userId) => {
    const req = {
        method: 'POST',
        url: '/data-download',
        originalUrl: '/api/settings/data-download',
        headers: { 'x-user-id': userId },
        body: {},
        query: {},
        params: {},
        get: (name) => {
            const key = String(name || '').toLowerCase();
            return req.headers[key];
        },
    };

    const res = {
        statusCode: 200,
        body: undefined,
        locals: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error) => {
            if (settled) return;
            settled = true;
            if (error) return reject(error);
            return resolve(value);
        };

        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            originalJson(payload);
            finish({ status: res.statusCode, body: res.body });
            return res;
        };

        settingsRoutes.handle(req, res, (error) => {
            if (error) return finish(null, error);
            return finish({ status: res.statusCode, body: res.body });
        });
    });
};

const buildPersistedExportDoc = (id) => {
    const persisted = {
        _id: id,
        exportRequests: [{ _id: 'exp-1', requestedAt: new Date(), status: 'pending' }],
        save: jest.fn().mockResolvedValue(undefined),
    };
    persisted.exportRequests.id = (requestId) => persisted.exportRequests.find((row) => String(row._id) === String(requestId));
    return persisted;
};

describe('POST /api/settings/data-download worker export contract', () => {
    let warnSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        RevenueEvent.aggregate.mockResolvedValue([]);
        RevenueEvent.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: async () => [],
                }),
            }),
        });
        Job.countDocuments.mockResolvedValue(0);
        Job.find.mockReturnValue({
            lean: async () => [],
        });
        Application.findOne.mockReturnValue({
            lean: async () => ({ worker: 'worker-profile-1' }),
        });
        isRegionFeatureEnabled.mockResolvedValue(true);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('returns applications using WorkerProfile._id and populates job', async () => {
        const { userDoc } = buildUserDoc({ id: 'candidate-user-1', role: 'candidate' });
        User.findById
            .mockResolvedValueOnce(userDoc)
            .mockResolvedValueOnce(buildPersistedExportDoc('candidate-user-1'));

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({
                _id: 'worker-profile-1',
                city: 'Hyderabad',
                roleProfiles: [{ roleName: 'Cook', skills: ['Meal Prep'] }],
            }),
        });

        Application.find.mockReturnValue({
            populate: () => ({
                lean: async () => [{
                    _id: 'application-1',
                    worker: 'worker-profile-1',
                    status: 'hired',
                    job: { _id: 'job-1', title: 'Cook', companyName: 'Kitchen Co' },
                }],
            }),
        });

        const response = await invokeDataDownload('candidate-user-1');

        expect(response.status).toBe(202);
        expect(Application.find).toHaveBeenCalledWith({ worker: 'worker-profile-1' });
        expect(Application.find).not.toHaveBeenCalledWith({ worker: 'candidate-user-1' });

        const payload = readExportPayloadFromMockWrite();
        expect(Array.isArray(payload.applications)).toBe(true);
        expect(payload.applications).toHaveLength(1);
        expect(payload.applications[0].status).toBe('hired');
        expect(payload.applications[0].job).toEqual(expect.objectContaining({
            _id: 'job-1',
            title: 'Cook',
        }));
    });

    it('logs and returns empty applications when WorkerProfile is missing', async () => {
        const { userDoc } = buildUserDoc({ id: 'candidate-user-2', role: 'candidate' });
        User.findById
            .mockResolvedValueOnce(userDoc)
            .mockResolvedValueOnce(buildPersistedExportDoc('candidate-user-2'));

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => null,
        });

        const response = await invokeDataDownload('candidate-user-2');

        expect(response.status).toBe(202);
        expect(Application.find).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[EXPORT] WorkerProfile missing for user'));

        const payload = readExportPayloadFromMockWrite();
        expect(Array.isArray(payload.applications)).toBe(true);
        expect(payload.applications).toEqual([]);
    });
});
