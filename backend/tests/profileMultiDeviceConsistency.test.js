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
const {
    setSocketIoServer,
    registerSocketSession,
    clearSocketSessionsForUser,
    revokeDeviceSession,
} = require('../services/sessionService');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('profile multi-device consistency', () => {
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

    it('broadcasts profile role switch to all active device sessions', async () => {
        const emit = jest.fn();
        const to = jest.fn().mockReturnValue({ emit });
        const io = { to };

        const userDoc = {
            _id: '507f191e810c19729de860b5',
            isDeleted: false,
            isAdmin: false,
            isExperimentUser: false,
            linkedAccounts: { emailPassword: true },
            name: 'Multi Device User',
            email: 'multi.device@example.com',
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
                select: jest.fn().mockResolvedValue({
                    ...userDoc,
                    role: 'recruiter',
                    activeRole: 'employer',
                    primaryRole: 'employer',
                }),
            });

        WorkerProfile.findOne.mockReturnValue({
            lean: async () => ({ city: 'Pune', roleProfiles: [] }),
        });
        EmployerProfile.findOne.mockReturnValue({
            lean: async () => ({ companyName: 'Acme', location: 'Pune' }),
        });

        const req = {
            user: { _id: userDoc._id },
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

        expect(to).toHaveBeenCalledWith(`user_${userDoc._id}`);
        expect(emit).toHaveBeenCalledWith('session_role_updated', expect.objectContaining({
            activeRole: 'employer',
        }));
    });

    it('revokes only device A session and preserves device B until explicit global logout', async () => {
        const sessionUser = {
            deviceSessions: [
                { deviceId: 'device-A', platform: 'mobile', revokedAt: null, lastSeenAt: new Date() },
                { deviceId: 'device-B', platform: 'mobile', revokedAt: null, lastSeenAt: new Date() },
            ],
        };

        const revoked = revokeDeviceSession({ user: sessionUser, deviceId: 'device-A' });
        expect(revoked).toBe(1);
        expect(sessionUser.deviceSessions.find((row) => row.deviceId === 'device-A')?.revokedAt).toBeTruthy();
        expect(sessionUser.deviceSessions.find((row) => row.deviceId === 'device-B')?.revokedAt).toBeNull();

        const socketA = { disconnect: jest.fn() };
        const socketB = { disconnect: jest.fn() };
        setSocketIoServer({
            sockets: {
                sockets: new Map([
                    ['socket-A', socketA],
                    ['socket-B', socketB],
                ]),
            },
        });

        await registerSocketSession({ userId: 'user-1', socketId: 'socket-A' });
        await registerSocketSession({ userId: 'user-1', socketId: 'socket-B' });
        const disconnected = await clearSocketSessionsForUser({
            userId: 'user-1',
            disconnect: true,
        });

        expect(disconnected.disconnected).toBe(2);
        expect(socketA.disconnect).toHaveBeenCalledWith(true);
        expect(socketB.disconnect).toHaveBeenCalledWith(true);
    });
});
