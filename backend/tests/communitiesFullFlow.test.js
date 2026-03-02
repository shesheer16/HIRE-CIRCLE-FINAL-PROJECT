const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: req.headers['x-user-id'] || 'user-1',
            name: 'Community User',
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
}));

jest.mock('../models/CirclePost', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/CommunityTrustScore', () => ({
    find: jest.fn().mockResolvedValue([]),
}));

jest.mock('../models/Post', () => ({
    create: jest.fn().mockResolvedValue({}),
}));

jest.mock('../models/userModel', () => ({
    find: jest.fn(),
}));

jest.mock('../services/communityTrustService', () => ({
    computeCommunityTrustScore: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/trustGraphService', () => ({
    recordTrustEdge: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/notificationEngineService', () => ({
    queueNotificationDispatch: jest.fn().mockResolvedValue(null),
}));

const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const User = require('../models/userModel');

describe('communities full flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates community and returns normalized payload', async () => {
        Circle.create.mockResolvedValue({
            _id: '507f191e810c19729de860ea',
            name: 'Logistics Circle',
            description: 'Ops',
            category: 'logistics',
            skill: 'logistics',
            location: 'Pune',
            privacy: 'public',
            createdBy: 'user-1',
            adminIds: ['user-1'],
            memberIds: ['user-1'],
            members: ['user-1'],
            communityTrustScore: 50,
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
                return this;
            },
        });

        const app = express();
        app.use(express.json());
        app.use('/api/circles', require('../routes/circlesRoutes'));

        const res = await request(app)
            .post('/api/circles')
            .send({
                name: 'Logistics Circle',
                description: 'Ops',
                category: 'logistics',
            })
            .expect(201);

        expect(res.body.community.name).toBe('Logistics Circle');
        expect(Circle.create).toHaveBeenCalled();
    });

    it('enforces membership boundaries for posting and supports member listing', async () => {
        const privateCircle = {
            _id: '507f191e810c19729de860eb',
            name: 'Private Circle',
            memberIds: ['owner-1'],
            members: ['owner-1'],
            adminIds: ['owner-1'],
            createdBy: 'owner-1',
            privacy: 'private',
            isPrivate: true,
            save: jest.fn().mockResolvedValue(null),
        };

        Circle.findById
            .mockResolvedValueOnce(privateCircle)
            .mockReturnValueOnce({
                lean: async () => ({
                    ...privateCircle,
                    memberIds: ['owner-1', 'user-1'],
                    adminIds: ['owner-1'],
                    privacy: 'private',
                }),
            });

        User.find.mockReturnValue({
            select: () => ({
                lean: async () => ([
                    { _id: 'owner-1', name: 'Owner', activeRole: 'employer', primaryRole: 'employer' },
                    { _id: 'user-1', name: 'Member', activeRole: 'worker', primaryRole: 'worker' },
                ]),
            }),
        });

        const app = express();
        app.use(express.json());
        app.use('/api/circles', require('../routes/circlesRoutes'));

        await request(app)
            .post('/api/circles/507f191e810c19729de860eb/posts')
            .set('x-user-id', 'user-1')
            .send({ text: 'Hello' })
            .expect(403);

        const memberRes = await request(app)
            .get('/api/circles/507f191e810c19729de860eb/members')
            .set('x-user-id', 'user-1')
            .expect(200);

        expect(memberRes.body.members.length).toBe(2);
    });

    it('creates community post for member and sanitizes post text', async () => {
        Circle.findById.mockResolvedValue({
            _id: '507f191e810c19729de860ec',
            createdBy: 'owner-1',
            memberIds: ['user-1'],
            members: ['user-1'],
            adminIds: ['owner-1'],
            privacy: 'public',
            isPrivate: false,
            save: jest.fn().mockResolvedValue(null),
        });
        CirclePost.create.mockResolvedValue({
            _id: 'post-1',
            circle: '507f191e810c19729de860ec',
            user: 'user-1',
            text: '&lt;img src=x onerror=alert(1)&gt;',
            createdAt: new Date(),
        });
        CirclePost.findById.mockReturnValue({
            populate: () => ({
                lean: async () => ({
                    _id: 'post-1',
                    circle: '507f191e810c19729de860ec',
                    user: { _id: 'user-1', name: 'Member', activeRole: 'worker', primaryRole: 'worker' },
                    text: '&lt;img src=x onerror=alert(1)&gt;',
                    createdAt: new Date(),
                }),
            }),
        });

        const app = express();
        app.use(express.json());
        app.use('/api/circles', require('../routes/circlesRoutes'));

        const res = await request(app)
            .post('/api/circles/507f191e810c19729de860ec/posts')
            .send({ text: '<img src=x onerror=alert(1)>' })
            .expect(201);

        expect(CirclePost.create).toHaveBeenCalled();
        expect(String(CirclePost.create.mock.calls[0][0].text)).toContain('&lt;img');
        expect(res.body.post.text).toContain('&lt;img');
    });
});
