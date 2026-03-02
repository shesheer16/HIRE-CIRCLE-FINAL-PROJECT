const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: '507f191e810c19729de860ea',
            name: 'Referral User',
        };
        next();
    },
}));

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
    find: jest.fn(),
}));
jest.mock('../models/Job', () => ({
    findById: jest.fn(),
    find: jest.fn(),
}));
jest.mock('../models/Bounty', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/Circle', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/Post', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/Referral', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    aggregate: jest.fn(),
}));
jest.mock('../models/WorkerProfile', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/EmployerProfile', () => ({
    findOne: jest.fn(),
}));
jest.mock('../models/UserNetworkScore', () => ({}));

jest.mock('../services/referralService', () => ({
    ensureUserReferralCode: jest.fn().mockResolvedValue('ABC123'),
    getReferralDashboard: jest.fn().mockResolvedValue({
        referralCode: 'ABC123',
        inviteLink: 'https://hireapp.com/signup?ref=ABC123',
        rewardsGranted: 0,
        creditsEarned: 0,
        referrals: [],
    }),
}));

jest.mock('../services/growthLinkService', () => ({
    buildJobShareLink: jest.fn().mockReturnValue('https://hireapp.com/jobs/one'),
    buildProfileShareLink: jest.fn().mockReturnValue('https://hireapp.com/profiles/one'),
    buildCommunityShareLink: jest.fn().mockReturnValue('https://hireapp.com/community/one'),
    buildBountyShareLink: jest.fn().mockReturnValue('https://hireapp.com/bounties/one'),
    buildReferralInviteLink: jest.fn().mockReturnValue('https://hireapp.com/signup?ref=ABC123'),
    extractObjectIdFromSeoSlug: jest.fn().mockImplementation((value) => value),
    buildSeoMetadata: jest.fn().mockReturnValue({}),
    getWebBaseUrl: jest.fn().mockReturnValue('https://hireapp.com'),
}));

jest.mock('../services/experimentService', () => ({
    assignUserToExperiment: jest.fn().mockResolvedValue({ key: 'x', variant: 'A' }),
    getOrCreateExperiment: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/growthMetricsService', () => ({
    getLatestGrowthMetrics: jest.fn().mockResolvedValue({}),
    upsertGrowthMetricsForDay: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/monetizationIntelligenceService', () => ({
    getMonetizationIntelligence: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/growthConversionService', () => ({
    getConversionNudges: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/networkScoreService', () => ({
    recomputeUserNetworkScore: jest.fn().mockResolvedValue({ score: 0 }),
}));
jest.mock('../services/growthFunnelService', () => ({
    getFunnelVisualization: jest.fn().mockResolvedValue({}),
}));

const Job = require('../models/Job');
const Bounty = require('../models/Bounty');
const Post = require('../models/Post');
const Referral = require('../models/Referral');

describe('referral system flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects referral submission without jobId or bountyId', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/growth', require('../routes/growthRoutes'));

        await request(app)
            .post('/api/growth/referrals')
            .send({ candidateContact: '9876543210' })
            .expect(400);
    });

    it('tracks bounty referrals and blocks duplicates', async () => {
        Bounty.findById.mockResolvedValue({ _id: '507f191e810c19729de860eb' });
        Referral.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'ref-1' });
        Referral.create.mockResolvedValue({
            _id: 'ref-2',
            reward: 0,
        });

        const app = express();
        app.use(express.json());
        app.use('/api/growth', require('../routes/growthRoutes'));

        const createRes = await request(app)
            .post('/api/growth/referrals')
            .send({
                bountyId: '507f191e810c19729de860eb',
                candidateContact: '9876543210',
                reward: 999999,
            })
            .expect(201);

        expect(createRes.body.referral.reward).toBe(0);

        await request(app)
            .post('/api/growth/referrals')
            .send({
                bountyId: '507f191e810c19729de860eb',
                candidateContact: '9876543210',
            })
            .expect(409);
    });

    it('returns bounty share-link from bounty id when post row is absent', async () => {
        Post.findById.mockResolvedValue(null);
        Bounty.findById.mockResolvedValue({
            _id: '507f191e810c19729de860eb',
            title: 'Referral bounty',
        });
        Job.findById.mockResolvedValue(null);

        const app = express();
        app.use(express.json());
        app.use('/api/growth', require('../routes/growthRoutes'));

        const res = await request(app)
            .get('/api/growth/share-link/bounty/507f191e810c19729de860eb')
            .expect(200);

        expect(res.body.shareLink).toContain('/bounties/');
    });
});
