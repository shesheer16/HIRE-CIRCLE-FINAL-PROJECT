const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: 'user-1',
            name: 'Pulse User',
        };
        next();
    },
}));

jest.mock('../models/Post', () => ({
    find: jest.fn(),
    insertMany: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../services/feedRankingService', () => ({
    fetchRankedPosts: jest.fn(),
    normalizePostTypeList: jest.fn().mockReturnValue([]),
}));

const Post = require('../models/Post');
const Job = require('../models/Job');
const { fetchRankedPosts } = require('../services/feedRankingService');

describe('pulse full flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('serves ranked pulse items with stable pagination contract', async () => {
        fetchRankedPosts.mockResolvedValue({
            posts: [
                {
                    _id: 'post-1',
                    postType: 'community',
                    content: 'Community update',
                    author: { name: 'Alice' },
                    createdAt: '2026-02-01T10:00:00.000Z',
                    engagementScore: 0.93,
                    interactionCount: 16,
                },
            ],
            page: 2,
            limit: 5,
            hasMore: true,
            total: 12,
        });

        const app = express();
        app.use(express.json());
        app.use('/api/pulse', require('../routes/pulseRoutes'));

        const res = await request(app)
            .get('/api/pulse?page=2&limit=5')
            .expect(200);

        expect(res.body.source).toBe('posts');
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(5);
        expect(res.body.hasMore).toBe(true);
        expect(res.body.total).toBe(12);
        expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('falls back to live jobs and persists derived posts without mock data', async () => {
        fetchRankedPosts.mockResolvedValue({
            posts: [],
            page: 1,
            limit: 2,
            hasMore: false,
            total: 0,
        });

        Job.find.mockReturnValue({
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        lean: async () => ([
                            {
                                _id: '507f191e810c19729de860ea',
                                title: 'Warehouse Supervisor',
                                companyName: 'Acme',
                                location: 'Pune',
                                salaryRange: 'INR 25k-30k',
                                createdAt: new Date('2026-02-01T00:00:00.000Z'),
                                viewCount: 10,
                                employerId: '507f191e810c19729de860eb',
                                isPulse: true,
                                isOpen: true,
                                status: 'active',
                            },
                        ]),
                    }),
                }),
            }),
        });
        Job.countDocuments.mockResolvedValue(1);
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
            .get('/api/pulse?page=1&limit=2')
            .expect(200);

        expect(res.body.source).toBe('jobs');
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items.length).toBe(1);
        expect(Post.insertMany).toHaveBeenCalled();
    });

    it('contains no mock/static pulse payload literals in route source', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'routes', 'pulseRoutes.js'),
            'utf8'
        );
        expect(source).not.toMatch(/mock\s*data|sample\s*data|dummy\s*json/i);
    });
});
