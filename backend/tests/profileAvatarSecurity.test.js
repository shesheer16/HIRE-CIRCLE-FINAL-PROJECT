jest.mock('fs/promises', () => ({
    readFile: jest.fn(),
    unlink: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../services/s3Service', () => ({
    uploadToS3: jest.fn(),
    deleteObjectByUrl: jest.fn().mockResolvedValue(true),
}));

const fs = require('fs/promises');
const WorkerProfile = require('../models/WorkerProfile');
const { uploadToS3, deleteObjectByUrl } = require('../services/s3Service');
const { updateAvatar } = require('../controllers/settingsController');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('profile avatar security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects MIME spoofing when file signature does not match declared image type', async () => {
        fs.readFile.mockResolvedValue(Buffer.from('not-an-image-payload'));
        const req = {
            user: {
                _id: '507f191e810c19729de860ac',
                role: 'candidate',
                activeRole: 'worker',
                primaryRole: 'worker',
            },
            file: {
                path: '/tmp/avatar.jpg',
                mimetype: 'image/jpeg',
            },
        };
        const res = makeRes();

        await updateAvatar(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/does not match supported image types/i),
        }));
        expect(uploadToS3).not.toHaveBeenCalled();
    });

    it('replaces avatar and cleans up previous object when upload is valid', async () => {
        fs.readFile.mockResolvedValue(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d,
        ]));
        WorkerProfile.findOne.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    avatar: 'https://assets.example.com/avatars/workers/old-avatar.png',
                }),
            }),
        });
        WorkerProfile.findOneAndUpdate.mockResolvedValue({
            _id: 'worker-profile-avatar',
            avatar: 'https://assets.example.com/avatars/workers/new-avatar.png',
        });
        uploadToS3.mockResolvedValue('https://assets.example.com/avatars/workers/new-avatar.png');

        const req = {
            user: {
                _id: '507f191e810c19729de860ac',
                role: 'candidate',
                activeRole: 'worker',
                primaryRole: 'worker',
            },
            file: {
                path: '/tmp/avatar.png',
                mimetype: 'image/png',
            },
        };
        const res = makeRes();

        await updateAvatar(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            avatarUrl: 'https://assets.example.com/avatars/workers/new-avatar.png',
            profileCompletion: expect.any(Object),
        }));
        expect(deleteObjectByUrl).toHaveBeenCalledWith('https://assets.example.com/avatars/workers/old-avatar.png');
    });
});
