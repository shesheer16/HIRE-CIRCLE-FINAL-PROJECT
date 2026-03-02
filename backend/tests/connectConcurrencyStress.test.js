const express = require('express');
const request = require('supertest');

const toObjectId = (n) => n.toString(16).padStart(24, '0').slice(-24);

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: req.headers['x-user-id'] || 'user-1',
            name: 'Concurrent User',
            activeRole: 'worker',
            primaryRole: 'worker',
            isVerified: true,
            hasCompletedProfile: true,
        };
        next();
    },
}));

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/trustGuardMiddleware', () => ({
    trustGuard: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/rateLimiters', () => ({
    communityCreateLimiter: (_req, _res, next) => next(),
}));
jest.mock('../middleware/featureFlagMiddleware', () => ({
    requireFeatureFlag: () => (_req, _res, next) => next(),
}));

jest.mock('../models/Post', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
    insertMany: jest.fn(),
    deleteOne: jest.fn(),
}));
jest.mock('../models/Circle', () => ({
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
}));
jest.mock('../models/CirclePost', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
}));
jest.mock('../models/CommunityTrustScore', () => ({
    find: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/userModel', () => ({
    find: jest.fn().mockReturnValue({
        select: () => ({
            lean: async () => [],
        }),
    }),
}));
jest.mock('../models/Job', () => ({
    findById: jest.fn(),
    find: jest.fn(),
}));
jest.mock('../models/Bounty', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/Referral', () => ({
    findOne: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    aggregate: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/WorkerProfile', () => ({
    findById: jest.fn(),
}));
jest.mock('../models/EmployerProfile', () => ({
    findOne: jest.fn(),
}));
jest.mock('../models/UserNetworkScore', () => ({}));

jest.mock('../services/feedRankingService', () => ({
    fetchRankedPosts: jest.fn().mockResolvedValue({
        posts: [],
        hasMore: false,
        page: 1,
        limit: 20,
        total: 0,
    }),
    normalizePostTypeList: jest.fn().mockReturnValue([]),
}));
jest.mock('../services/featureFlagService', () => ({
    getFeatureFlag: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/eventLoggingService', () => ({
    safeLogPlatformEvent: jest.fn(),
}));
jest.mock('../services/growthNotificationService', () => ({
    createAndSendBehaviorNotification: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/notificationEngineService', () => ({
    queueNotificationDispatch: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/monetizationIntelligenceService', () => ({
    recordFeatureUsage: jest.fn().mockResolvedValue(null),
    getMonetizationIntelligence: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/networkScoreService', () => ({
    recomputeUserNetworkScore: jest.fn().mockResolvedValue({ score: 0 }),
}));
jest.mock('../services/cacheService', () => ({
    buildCacheKey: jest.fn().mockReturnValue('connect:stress'),
    getJSON: jest.fn().mockResolvedValue(null),
    setJSON: jest.fn().mockResolvedValue(null),
    delByPattern: jest.fn().mockResolvedValue(null),
    CACHE_TTL_SECONDS: { feed: 60 },
}));
jest.mock('../services/communityTrustService', () => ({
    computeCommunityTrustScore: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/trustGraphService', () => ({
    recordTrustEdge: jest.fn().mockResolvedValue(null),
}));
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
jest.mock('../services/growthConversionService', () => ({
    getConversionNudges: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/growthFunnelService', () => ({
    getFunnelVisualization: jest.fn().mockResolvedValue({}),
}));

const Post = require('../models/Post');
const Circle = require('../models/Circle');
const Bounty = require('../models/Bounty');
const Referral = require('../models/Referral');

describe('connect concurrency stress', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('handles concurrent post creation, likes, community joins, and referrals without duplicate state', async () => {
        const postStore = new Map();
        let postCounter = 1;
        const likePostId = toObjectId(9900);
        postStore.set(likePostId, {
            _id: likePostId,
            user: 'owner-1',
            authorId: 'owner-1',
            content: 'Like target',
            type: 'text',
            postType: 'status',
            visibility: 'public',
            likes: [],
            comments: [],
            vouches: [],
        });

        Post.create.mockImplementation(async (payload) => {
            const id = toObjectId(postCounter);
            postCounter += 1;
            postStore.set(id, {
                _id: id,
                user: String(payload.user || ''),
                authorId: String(payload.authorId || payload.user || ''),
                content: payload.content || '',
                type: payload.type || 'text',
                postType: payload.postType || 'status',
                visibility: payload.visibility || 'public',
                likes: [],
                comments: [],
                vouches: [],
            });
            return { _id: id };
        });
        Post.findById.mockImplementation((id) => {
            const doc = postStore.get(String(id));
            if (!doc) return null;
            return {
                ...doc,
                save: async () => null,
                populate: () => ({
                    lean: async () => ({
                        ...doc,
                        authorId: {
                            _id: doc.authorId,
                            name: 'Author',
                            activeRole: 'worker',
                            primaryRole: 'worker',
                        },
                    }),
                }),
            };
        });

        const circleId = toObjectId(8800);
        const circleDoc = {
            _id: circleId,
            name: 'Concurrent Circle',
            createdBy: 'owner-1',
            memberIds: ['owner-1'],
            members: ['owner-1'],
            adminIds: ['owner-1'],
            privacy: 'public',
            isPrivate: false,
            save: async () => null,
        };
        Circle.findById.mockImplementation(async (id) => {
            if (String(id) === circleId) return circleDoc;
            return null;
        });
        Circle.find.mockReturnValue({
            sort: () => ({
                lean: async () => [],
            }),
        });

        Bounty.findById.mockResolvedValue({ _id: toObjectId(7700) });
        Referral.findOne.mockResolvedValue(null);
        const referralCreates = [];
        Referral.create.mockImplementation(async (payload) => {
            referralCreates.push(payload);
            return {
                _id: toObjectId(6600 + referralCreates.length),
                reward: payload.reward,
            };
        });

        const app = express();
        app.use(express.json());
        app.use('/api/feed', require('../routes/feedRoutes'));
        app.use('/api/circles', require('../routes/circlesRoutes'));
        app.use('/api/growth', require('../routes/growthRoutes'));

        const postReqs = Array.from({ length: 20 }, (_item, index) => request(app)
            .post('/api/feed/posts')
            .set('x-user-id', `creator-${index}`)
            .send({ type: 'text', content: `concurrent post ${index}` }));

        const joinReqs = Array.from({ length: 10 }, (_item, index) => request(app)
            .post(`/api/circles/${circleId}/join`)
            .set('x-user-id', `joiner-${index}`)
            .send({}));

        const likeReqs = Array.from({ length: 50 }, (_item, index) => request(app)
            .post(`/api/feed/posts/${likePostId}/like`)
            .set('x-user-id', `liker-${index}`)
            .send({}));

        const referralReqs = Array.from({ length: 20 }, (_item, index) => request(app)
            .post('/api/growth/referrals')
            .set('x-user-id', `referrer-${index}`)
            .send({
                bountyId: toObjectId(7700),
                candidateContact: `900000${(1000 + index)}`,
            }));

        const responses = await Promise.all([
            ...postReqs,
            ...joinReqs,
            ...likeReqs,
            ...referralReqs,
        ]);

        responses.forEach((res) => {
            expect([200, 201, 202]).toContain(res.status);
        });

        const createdPostIds = responses
            .filter((res) => res.body?.post?._id && res.req.path === '/api/feed/posts')
            .map((res) => String(res.body.post._id));
        expect(new Set(createdPostIds).size).toBe(createdPostIds.length);

        expect(new Set(circleDoc.memberIds).size).toBe(circleDoc.memberIds.length);
        expect(circleDoc.memberIds.length).toBeGreaterThanOrEqual(11);

        const likeDoc = postStore.get(likePostId);
        expect(new Set(likeDoc.likes).size).toBe(likeDoc.likes.length);
        expect(likeDoc.likes.length).toBe(50);

        expect(referralCreates.length).toBe(20);
    });
});
