const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: req.headers['x-user-id'] || 'user-1',
            name: 'Connect User',
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
}));

jest.mock('../services/networkScoreService', () => ({
    recomputeUserNetworkScore: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/cacheService', () => ({
    buildCacheKey: jest.fn().mockReturnValue('feed:key'),
    getJSON: jest.fn().mockResolvedValue(null),
    setJSON: jest.fn().mockResolvedValue(null),
    delByPattern: jest.fn().mockResolvedValue(null),
    CACHE_TTL_SECONDS: {
        feed: 60,
    },
}));

jest.mock('../models/Post', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest.fn(),
}));

const Post = require('../models/Post');

describe('connect feed full flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates feed post and sanitizes unsafe content', async () => {
        const created = {
            _id: '507f191e810c19729de860ea',
        };
        Post.create.mockResolvedValue(created);
        Post.findById.mockReturnValue({
            populate: () => ({
                lean: async () => ({
                    _id: created._id,
                    authorId: {
                        _id: 'user-1',
                        name: 'Connect User',
                        activeRole: 'worker',
                        primaryRole: 'worker',
                    },
                    user: 'user-1',
                    postType: 'status',
                    type: 'text',
                    content: '&lt;script&gt;alert(1)&lt;/script&gt;',
                    visibility: 'public',
                    media: [],
                    mediaUrl: '',
                    likes: [],
                    comments: [],
                    vouches: [],
                }),
            }),
        });

        const app = express();
        app.use(express.json());
        app.use('/api/feed', require('../routes/feedRoutes'));

        const res = await request(app)
            .post('/api/feed/posts')
            .send({
                type: 'text',
                content: '<script>alert(1)</script>',
            })
            .expect(201);

        expect(Post.create).toHaveBeenCalled();
        expect(String(Post.create.mock.calls[0][0].content || '')).toContain('&lt;script&gt;');
        expect(res.body.post.content).toContain('&lt;script&gt;');
    });

    it('edits and deletes post with ownership validation', async () => {
        const postDoc = {
            _id: '507f191e810c19729de860eb',
            authorId: 'user-1',
            user: 'user-1',
            content: 'before',
            visibility: 'public',
            save: jest.fn().mockResolvedValue(null),
        };

        Post.findById
            .mockResolvedValueOnce(postDoc)
            .mockReturnValueOnce({
                populate: () => ({
                    lean: async () => ({
                        _id: postDoc._id,
                        authorId: {
                            _id: 'user-1',
                            name: 'Connect User',
                            activeRole: 'worker',
                            primaryRole: 'worker',
                        },
                        user: 'user-1',
                        postType: 'status',
                        type: 'text',
                        content: '&lt;b&gt;after&lt;/b&gt;',
                        visibility: 'connections',
                        media: [],
                        mediaUrl: '',
                        likes: [],
                        comments: [],
                        vouches: [],
                    }),
                }),
            });
        Post.deleteOne.mockResolvedValue({ deletedCount: 1 });

        const app = express();
        app.use(express.json());
        app.use('/api/feed', require('../routes/feedRoutes'));

        await request(app)
            .put(`/api/feed/posts/${postDoc._id}`)
            .send({
                content: '<b>after</b>',
                visibility: 'connections',
            })
            .expect(200);

        expect(postDoc.save).toHaveBeenCalled();

        Post.findById.mockResolvedValueOnce({
            _id: postDoc._id,
            authorId: 'user-1',
            user: 'user-1',
        });
        await request(app)
            .delete(`/api/feed/posts/${postDoc._id}`)
            .expect(200);

        expect(Post.deleteOne).toHaveBeenCalledWith({ _id: postDoc._id });
    });

    it('blocks delete by non-owner and rejects invalid post id for like', async () => {
        Post.findById.mockResolvedValue({
            _id: '507f191e810c19729de860ec',
            authorId: 'owner-2',
            user: 'owner-2',
        });

        const app = express();
        app.use(express.json());
        app.use('/api/feed', require('../routes/feedRoutes'));

        await request(app)
            .delete('/api/feed/posts/507f191e810c19729de860ec')
            .set('x-user-id', 'user-1')
            .expect(403);

        await request(app)
            .post('/api/feed/posts/not-an-objectid/like')
            .expect(400);
    });
});
