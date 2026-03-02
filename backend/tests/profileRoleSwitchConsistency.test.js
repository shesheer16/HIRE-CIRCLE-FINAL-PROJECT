jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));

jest.mock('../models/EmployerProfile', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
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

jest.mock('../services/cacheService', () => ({
    delByPattern: jest.fn().mockResolvedValue(0),
}));

const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const RevenueEvent = require('../models/RevenueEvent');
const { updateSettings } = require('../controllers/settingsController');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('profile role switch consistency', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Job.countDocuments.mockResolvedValue(0);
        Application.findOne.mockReturnValue({ lean: async () => null });
        RevenueEvent.aggregate.mockResolvedValue([]);
        RevenueEvent.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: async () => [],
                }),
            }),
        });
    });

    it('updates role contract server-side and emits sync event for all sessions', async () => {
        const emit = jest.fn();
        const to = jest.fn().mockReturnValue({ emit });
        const io = { to };

        const mutableUser = {
            _id: '507f191e810c19729de860ad',
            isDeleted: false,
            isAdmin: false,
            isExperimentUser: false,
            linkedAccounts: { emailPassword: true },
            name: 'Role User',
            email: 'role.user@example.com',
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            roles: ['worker', 'employer'],
            capabilities: {
                canPostJob: false,
                canCreateCommunity: true,
                canCreateBounty: false,
            },
            notificationPreferences: {},
            privacyPreferences: {},
            featureToggles: {},
            globalPreferences: {},
            taxProfile: {},
            exportRequests: [],
            subscription: { plan: 'free', credits: 0, billingPeriod: 'none' },
            securitySettings: {},
            save: jest.fn().mockImplementation(async function saveUser() {
                return this;
            }),
        };

        User.findById
            .mockResolvedValueOnce(mutableUser)
            .mockReturnValueOnce({
                select: jest.fn().mockResolvedValue({
                    ...mutableUser,
                    role: 'recruiter',
                    activeRole: 'employer',
                    primaryRole: 'employer',
                    capabilities: {
                        canPostJob: true,
                        canCreateCommunity: true,
                        canCreateBounty: true,
                    },
                }),
            });

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({ city: 'Pune', roleProfiles: [] }),
        });
        EmployerProfile.findOne.mockReturnValue({
            lean: async () => ({ companyName: 'Acme', location: 'Pune' }),
        });

        const req = {
            user: { _id: mutableUser._id },
            body: {
                accountInfo: {
                    role: 'employer',
                },
            },
            app: {
                get: jest.fn().mockReturnValue(io),
            },
        };
        const res = makeRes();

        await updateSettings(req, res);

        expect(mutableUser.activeRole).toBe('employer');
        expect(mutableUser.role).toBe('recruiter');
        expect(mutableUser.capabilities.canPostJob).toBe(true);
        expect(to).toHaveBeenCalledWith(`user_${mutableUser._id}`);
        expect(emit).toHaveBeenCalledWith('session_role_updated', expect.objectContaining({
            userId: String(mutableUser._id),
            activeRole: 'employer',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            settings: expect.objectContaining({
                roleContract: expect.objectContaining({
                    activeRole: 'employer',
                }),
            }),
        }));
    });

    it('prevents privilege escalation from invalid role value', async () => {
        const userDoc = {
            _id: '507f191e810c19729de860ae',
            isDeleted: false,
            isAdmin: false,
            isExperimentUser: false,
            linkedAccounts: { emailPassword: true },
            name: 'Worker User',
            email: 'worker.user@example.com',
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            roles: ['worker', 'employer'],
            capabilities: {
                canPostJob: false,
                canCreateCommunity: true,
                canCreateBounty: false,
            },
            notificationPreferences: {},
            privacyPreferences: {},
            featureToggles: {},
            globalPreferences: {},
            taxProfile: {},
            exportRequests: [],
            subscription: { plan: 'free', credits: 0, billingPeriod: 'none' },
            securitySettings: {},
            save: jest.fn().mockResolvedValue(undefined),
        };

        User.findById
            .mockResolvedValueOnce(userDoc)
            .mockReturnValueOnce({
                select: jest.fn().mockResolvedValue(userDoc),
            });

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({ city: 'Pune', roleProfiles: [] }),
        });

        const req = {
            user: { _id: userDoc._id },
            body: {
                accountInfo: {
                    role: 'admin',
                },
            },
            app: {
                get: jest.fn().mockReturnValue(null),
            },
        };
        const res = makeRes();

        await updateSettings(req, res);

        expect(userDoc.activeRole).toBe('worker');
        expect(userDoc.role).toBe('candidate');
        expect(userDoc.capabilities.canPostJob).toBe(false);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            settings: expect.objectContaining({
                roleContract: expect.objectContaining({
                    activeRole: 'worker',
                }),
            }),
        }));
    });
});
