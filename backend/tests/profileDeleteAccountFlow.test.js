jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
}));

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
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn(),
}));

jest.mock('../models/Application', () => ({
    findOne: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/RevenueEvent', () => ({
    aggregate: jest.fn().mockResolvedValue([]),
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

jest.mock('../services/privacyService', () => ({
    deleteUserDataCascade: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const { deleteUserDataCascade } = require('../services/privacyService');
const { deleteAccount } = require('../controllers/settingsController');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('profile delete account flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('requires password confirmation and then performs full cascade deletion', async () => {
        const userId = '507f191e810c19729de860b3';
        User.findById.mockResolvedValue({
            _id: userId,
            password: 'hashed-password',
            isDeleted: false,
        });
        bcrypt.compare.mockResolvedValue(true);
        deleteUserDataCascade.mockResolvedValue({
            deleted: true,
            counts: { wallets: 1, messagesSoftDeleted: 2 },
        });

        const req = {
            user: { _id: userId },
            body: { password: 'Password123!' },
        };
        const res = makeRes();

        await deleteAccount(req, res);

        expect(bcrypt.compare).toHaveBeenCalledWith('Password123!', 'hashed-password');
        expect(deleteUserDataCascade).toHaveBeenCalledWith({ userId });
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
        }));
    });

    it('blocks deletion when password verification fails', async () => {
        User.findById.mockResolvedValue({
            _id: '507f191e810c19729de860b4',
            password: 'hashed-password',
            isDeleted: false,
        });
        bcrypt.compare.mockResolvedValue(false);

        const req = {
            user: { _id: '507f191e810c19729de860b4' },
            body: { password: 'WrongPassword' },
        };
        const res = makeRes();

        await deleteAccount(req, res);

        expect(deleteUserDataCascade).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/password confirmation failed/i),
        }));
    });
});
