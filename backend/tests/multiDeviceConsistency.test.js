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
const {
    setSocketIoServer,
    registerSocketSession,
    clearSocketSessionsForUser,
    revokeDeviceSession,
} = require('../services/sessionService');
const { updateSettings } = require('../controllers/settingsController');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('multi-device consistency', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSocketIoServer(null);
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

    it('keeps device session state consistent across A/B and handles socket reconnect safely', async () => {
        const userDoc = {
            deviceSessions: [],
        };

        // Device A login
        userDoc.deviceSessions.push({
            deviceId: 'device-A',
            platform: 'mobile',
            lastSeenAt: new Date(),
            revokedAt: null,
        });
        // Device B login
        userDoc.deviceSessions.push({
            deviceId: 'device-B',
            platform: 'mobile',
            lastSeenAt: new Date(),
            revokedAt: null,
        });

        const revoked = revokeDeviceSession({ user: userDoc, deviceId: 'device-A' });
        expect(revoked).toBe(1);
        expect(userDoc.deviceSessions.find((row) => row.deviceId === 'device-A')?.revokedAt).toBeTruthy();
        expect(userDoc.deviceSessions.find((row) => row.deviceId === 'device-B')?.revokedAt).toBeNull();

        const socketA = { disconnect: jest.fn() };
        const socketB = { disconnect: jest.fn() };
        const socketBReconnect = { disconnect: jest.fn() };
        setSocketIoServer({
            sockets: {
                sockets: new Map([
                    ['socket-A', socketA],
                    ['socket-B', socketB],
                    ['socket-B-reconnect', socketBReconnect],
                ]),
            },
        });

        await registerSocketSession({ userId: 'user-1', socketId: 'socket-A' });
        await registerSocketSession({ userId: 'user-1', socketId: 'socket-B' });
        await registerSocketSession({ userId: 'user-1', socketId: 'socket-B-reconnect' });

        const disconnected = await clearSocketSessionsForUser({
            userId: 'user-1',
            disconnect: true,
        });

        expect(disconnected.disconnected).toBe(3);
        expect(socketA.disconnect).toHaveBeenCalledWith(true);
        expect(socketB.disconnect).toHaveBeenCalledWith(true);
        expect(socketBReconnect.disconnect).toHaveBeenCalledWith(true);
    });

    it('emits role-switch sync event to all user sessions/devices', async () => {
        const emit = jest.fn();
        const to = jest.fn().mockReturnValue({ emit });
        const io = { to };

        const userWithPassword = {
            _id: 'user-42',
            isDeleted: false,
            isAdmin: false,
            isExperimentUser: false,
            linkedAccounts: { emailPassword: true },
            name: 'Role Switcher',
            email: 'role.switcher@example.com',
            phoneNumber: null,
            activeRole: 'worker',
            primaryRole: 'worker',
            role: 'candidate',
            roles: ['worker', 'employer'],
            capabilities: {
                canPostJob: false,
                canCreateCommunity: true,
                canCreateBounty: false,
            },
            subscription: { plan: 'free', credits: 3, billingPeriod: 'none' },
            notificationPreferences: {},
            privacyPreferences: {},
            featureToggles: {},
            globalPreferences: {},
            taxProfile: {},
            exportRequests: [],
            save: jest.fn().mockResolvedValue(undefined),
        };

        const latestUser = {
            ...userWithPassword,
            activeRole: 'employer',
            role: 'recruiter',
            capabilities: {
                canPostJob: true,
                canCreateCommunity: true,
                canCreateBounty: true,
            },
        };

        User.findById
            .mockResolvedValueOnce(userWithPassword)
            .mockReturnValueOnce({
                select: jest.fn().mockResolvedValue(latestUser),
            });

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({ city: 'Hyderabad', roleProfiles: [] }),
        });
        EmployerProfile.findOne.mockReturnValue({
            lean: async () => ({ companyName: 'Acme', location: 'Hyderabad' }),
        });

        const req = {
            user: { _id: 'user-42' },
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

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
        }));
        expect(to).toHaveBeenCalledWith('user_user-42');
        expect(emit).toHaveBeenCalledWith('session_role_updated', expect.objectContaining({
            userId: 'user-42',
            activeRole: 'employer',
            roles: expect.arrayContaining(['worker', 'employer']),
        }));
    });
});
