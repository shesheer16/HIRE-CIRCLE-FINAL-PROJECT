jest.mock('fs/promises', () => ({
    mkdir: jest.fn(),
    writeFile: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
}));

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../models/EmployerProfile', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
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
    create: jest.fn(),
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
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const RevenueEvent = require('../models/RevenueEvent');
const Notification = require('../models/Notification');
const { isRegionFeatureEnabled } = require('../services/regionFeatureFlagService');

const {
    getSettings,
    updateSettings,
    requestDataDownload,
    deleteAccount,
} = require('../controllers/settingsController');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('settingsController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Job.countDocuments.mockResolvedValue(0);
        Application.findOne.mockReturnValue({
            lean: async () => null,
        });
        RevenueEvent.aggregate.mockResolvedValue([]);
        RevenueEvent.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: async () => [],
                }),
            }),
        });
        isRegionFeatureEnabled.mockResolvedValue(true);
    });

    it('returns full settings payload for authenticated user', async () => {
        const userDoc = {
            _id: 'user-1',
            name: 'Lokesh',
            email: 'lokesh@example.com',
            role: 'candidate',
            primaryRole: 'worker',
            notificationPreferences: { pushEnabled: true },
            privacyPreferences: { profileVisibleToEmployers: true },
            linkedAccounts: { emailPassword: true },
            featureToggles: { FEATURE_MATCH_UI_V1: true },
            securitySettings: { twoFactorEnabled: false, twoFactorMethod: 'email' },
            exportRequests: [],
            subscription: { plan: 'free', credits: 3, billingPeriod: 'none' },
            toObject: function toObject() { return this; },
        };

        User.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue(userDoc),
        });
        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({
                city: 'Hyderabad',
                totalExperience: 4,
                roleProfiles: [{ skills: ['Dispatch', 'Warehouse'] }],
                settings: { matchPreferences: { minimumMatchTier: 'GOOD' } },
            }),
        });

        const req = { user: { _id: 'user-1' } };
        const res = mockRes();
        await getSettings(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            accountInfo: expect.objectContaining({
                name: 'Lokesh',
                email: 'lokesh@example.com',
                city: 'Hyderabad',
            }),
            notificationPreferences: expect.any(Object),
            privacyPreferences: expect.any(Object),
            matchPreferences: expect.any(Object),
            billingOverview: expect.any(Object),
        }));
    });

    it('blocks sensitive account updates without currentPassword', async () => {
        const userDoc = {
            _id: 'user-2',
            name: 'Lokesh',
            email: 'lokesh@example.com',
            phoneNumber: '+911234567890',
            role: 'candidate',
            primaryRole: 'worker',
            linkedAccounts: { emailPassword: true },
            password: 'hashed-password',
            save: jest.fn(),
        };

        User.findById.mockResolvedValue(userDoc);
        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({ city: 'Hyderabad', roleProfiles: [] }),
        });

        const req = {
            user: { _id: 'user-2' },
            body: {
                accountInfo: {
                    email: 'new-email@example.com',
                },
            },
        };
        const res = mockRes();
        await updateSettings(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('currentPassword'),
        }));
    });

    it('spawns a data export request and returns a download URL', async () => {
        const exportRequests = [];
        exportRequests.push = function pushWithId(item) {
            const row = { _id: 'exp-1', ...item };
            return Array.prototype.push.call(this, row);
        };

        const userDoc = {
            _id: 'user-3',
            name: 'Lokesh',
            email: 'lokesh@example.com',
            role: 'candidate',
            primaryRole: 'worker',
            city: 'Hyderabad',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            subscription: { plan: 'free', credits: 3, billingPeriod: 'none' },
            notificationPreferences: { pushEnabled: true },
            privacyPreferences: { profileVisibleToEmployers: true },
            linkedAccounts: { emailPassword: true },
            securitySettings: { twoFactorEnabled: false, twoFactorMethod: 'email' },
            exportRequests,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const persistedUserDoc = {
            _id: 'user-3',
            exportRequests: [{
                _id: 'exp-1',
                status: 'pending',
                requestedAt: new Date(),
            }],
            save: jest.fn().mockResolvedValue(undefined),
        };
        persistedUserDoc.exportRequests.id = (id) => persistedUserDoc.exportRequests.find((row) => String(row._id) === String(id));

        User.findById
            .mockResolvedValueOnce(userDoc)
            .mockResolvedValueOnce(persistedUserDoc);

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({
                _id: 'worker-profile-1',
                city: 'Hyderabad',
                totalExperience: 3,
                roleProfiles: [{ skills: ['Dispatch'] }],
                settings: { matchPreferences: { minimumMatchTier: 'GOOD' } },
            }),
        });
        Job.find.mockReturnValue({
            lean: async () => [],
        });
        Application.find.mockReturnValue({
            populate: () => ({
                lean: async () => [],
            }),
        });
        Notification.create.mockResolvedValue({});

        const req = { user: { _id: 'user-3' }, body: {} };
        const res = mockRes();
        await requestDataDownload(req, res);

        expect(fs.mkdir).toHaveBeenCalled();
        expect(fs.writeFile).toHaveBeenCalled();
        expect(Application.find).toHaveBeenCalledWith({ worker: 'worker-profile-1' });
        expect(Notification.create).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(202);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            status: 'ready',
            downloadUrl: expect.stringContaining('/exports/'),
        }));
    });

    it('rate-limits data export requests to one per week', async () => {
        User.findById.mockResolvedValue({
            _id: 'user-4',
            isDeleted: false,
            exportRequests: [{
                _id: 'exp-recent',
                requestedAt: new Date(Date.now() - (24 * 60 * 60 * 1000)),
            }],
        });

        const req = { user: { _id: 'user-4' }, body: {} };
        const res = mockRes();
        await requestDataDownload(req, res);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('once every 7 days'),
        }));
    });

    it('requires password reconfirmation for account deletion', async () => {
        const userDoc = {
            _id: 'user-5',
            password: 'hashed-password',
        };
        User.findById.mockResolvedValue(userDoc);
        bcrypt.compare.mockResolvedValue(false);

        const req = {
            user: { _id: 'user-5' },
            body: { password: 'wrong-password' },
        };
        const res = mockRes();
        await deleteAccount(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Password confirmation failed'),
        }));
        expect(WorkerProfile.updateMany).not.toHaveBeenCalled();
        expect(EmployerProfile.updateMany).not.toHaveBeenCalled();
    });
});
