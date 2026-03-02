const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const defaultAuthUser = {
    _id: 'user-1',
    name: 'Connect User',
    capabilities: {
        canCreateBounty: true,
    },
    isVerified: true,
    hasCompletedProfile: true,
    currencyCode: 'INR',
    activeRole: 'employer',
    primaryRole: 'employer',
    roles: ['worker', 'employer'],
};
let mockAuthUser = { ...defaultAuthUser };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = { ...mockAuthUser };
        next();
    },
}));

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/rateLimiters', () => ({
    communityCreateLimiter: (_req, _res, next) => next(),
}));

jest.mock('../middleware/trustGuardMiddleware', () => ({
    trustGuard: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/featureFlagMiddleware', () => ({
    requireFeatureFlag: () => (_req, _res, next) => next(),
}));

jest.mock('../models/Circle', () => ({
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
}));

jest.mock('../models/CirclePost', () => ({
    deleteMany: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/CommunityTrustScore', () => ({
    find: jest.fn(),
}));

jest.mock('../models/Post', () => ({
    create: jest.fn(),
    find: jest.fn(),
    insertMany: jest.fn(),
}));

jest.mock('../models/Bounty', () => ({
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/Course', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../models/UserCourseProgress', () => ({
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../services/communityTrustService', () => ({
    computeCommunityTrustScore: jest.fn(),
}));

jest.mock('../services/trustGraphService', () => ({
    recordTrustEdge: jest.fn(),
}));

jest.mock('../services/notificationEngineService', () => ({
    queueNotificationDispatch: jest.fn(),
}));

jest.mock('../services/regionFeatureFlagService', () => ({
    isRegionFeatureEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/feedRankingService', () => ({
    fetchRankedPosts: jest.fn(),
    normalizePostTypeList: jest.fn().mockReturnValue([]),
}));

const Circle = require('../models/Circle');
const Post = require('../models/Post');
const Bounty = require('../models/Bounty');
const Course = require('../models/Course');
const Job = require('../models/Job');
const { fetchRankedPosts } = require('../services/feedRankingService');

describe('connect real content validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthUser = { ...defaultAuthUser };
    });

    it('creates community records through persistent model path', async () => {
        Circle.create.mockResolvedValue({
            _id: 'circle-1',
            name: 'Logistics Leaders',
            description: 'Community',
            category: 'logistics',
            createdBy: 'user-1',
            adminIds: ['user-1'],
            memberIds: ['user-1'],
            privacy: 'public',
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
                return this;
            },
        });
        Post.create.mockResolvedValue({});

        const app = express();
        app.use(express.json());
        app.use('/api/circles', require('../routes/circlesRoutes'));

        const res = await request(app)
            .post('/api/circles')
            .send({
                name: 'Logistics Leaders',
                description: 'Community',
                category: 'logistics',
            })
            .expect(201);

        expect(Circle.create).toHaveBeenCalled();
        expect(res.body.community.name).toBe('Logistics Leaders');
    });

    it('creates bounty records through persistent model path', async () => {
        Bounty.create.mockResolvedValue({
            _id: 'bounty-1',
            creatorId: 'user-1',
            title: 'Need referral',
            description: 'Find candidate',
            reward: 5000,
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
            status: 'open',
            submissions: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
                return this;
            },
        });
        Post.create.mockResolvedValue({});

        const app = express();
        app.use(express.json());
        app.use('/api/bounties', require('../routes/bountyRoutes'));

        const res = await request(app)
            .post('/api/bounties')
            .send({
                title: 'Need referral',
                description: 'Find candidate',
                reward: 5000,
                deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            })
            .expect(201);

        expect(Bounty.create).toHaveBeenCalled();
        expect(res.body.bounty.title).toBe('Need referral');
    });

    it('allows bounty creation after role switch even when stale capability flags are false', async () => {
        mockAuthUser = {
            ...defaultAuthUser,
            capabilities: {
                canCreateBounty: false,
            },
            activeRole: 'employer',
            roles: ['worker', 'employer'],
        };
        Bounty.create.mockResolvedValue({
            _id: 'bounty-2',
            creatorId: 'user-1',
            title: 'Role switch bounty',
            description: 'Created after switching role',
            reward: 2000,
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
            status: 'open',
            submissions: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
                return this;
            },
        });
        Post.create.mockResolvedValue({});

        const app = express();
        app.use(express.json());
        app.use('/api/bounties', require('../routes/bountyRoutes'));

        await request(app)
            .post('/api/bounties')
            .send({
                title: 'Role switch bounty',
                description: 'Created after switching role',
                reward: 2000,
                deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            })
            .expect(201);
    });

    it('serves academy courses from model queries and not static dummy JSON', async () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'routes', 'academyRoutes.js'),
            'utf8'
        );
        expect(source).not.toMatch(/dummy\s*json|placeholder|mock\s*data/i);

        Course.find.mockReturnValue({
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        lean: async () => [{
                            _id: 'course-1',
                            title: 'Warehouse Excellence',
                            description: 'Real course',
                            modules: [],
                            level: 'beginner',
                            duration: '2h',
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }],
                    }),
                }),
            }),
        });
        Course.countDocuments.mockResolvedValue(1);

        const app = express();
        app.use(express.json());
        app.use('/api/academy', require('../routes/academyRoutes'));

        const res = await request(app)
            .get('/api/academy/courses?page=1&limit=10')
            .expect(200);

        expect(Course.find).toHaveBeenCalledWith({ isPublished: true });
        expect(res.body.courses[0].title).toBe('Warehouse Excellence');
        expect(res.body.total).toBe(1);
    });

    it('returns pulse feed with stable pagination fields', async () => {
        fetchRankedPosts.mockResolvedValue({
            posts: [
                {
                    _id: 'post-10',
                    postType: 'community',
                    content: 'Community update',
                    author: { name: 'A' },
                    createdAt: '2026-02-01T10:00:00.000Z',
                    engagementScore: 0.92,
                    interactionCount: 12,
                },
                {
                    _id: 'post-9',
                    postType: 'bounty',
                    content: 'Bounty update',
                    author: { name: 'B' },
                    createdAt: '2026-02-01T09:00:00.000Z',
                    engagementScore: 0.9,
                    interactionCount: 10,
                },
            ],
            page: 2,
            limit: 2,
            hasMore: true,
            total: 6,
        });
        Job.find.mockReturnValue({
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        lean: async () => [],
                    }),
                }),
            }),
        });
        Job.countDocuments.mockResolvedValue(0);
        Post.find.mockReturnValue({
            select: () => ({
                lean: async () => [],
            }),
        });
        Post.insertMany.mockResolvedValue([]);

        const app = express();
        app.use(express.json());
        app.use('/api/pulse', require('../routes/pulseRoutes'));

        const res = await request(app)
            .get('/api/pulse?page=2&limit=2')
            .expect(200);

        expect(fetchRankedPosts).toHaveBeenCalled();
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(2);
        expect(res.body.hasMore).toBe(true);
        expect(res.body.total).toBe(6);
        expect(res.body.source).toBe('posts');
        expect(res.body.items.map((item) => item.id)).toEqual(['post-10', 'post-9']);
    });
});
