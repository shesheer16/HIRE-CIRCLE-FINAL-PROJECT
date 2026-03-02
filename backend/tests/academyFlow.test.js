const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: 'user-1',
            isAdmin: req.headers['x-admin'] === '1',
            activeRole: req.headers['x-role'] || 'worker',
            primaryRole: req.headers['x-role'] || 'worker',
            isVerified: true,
            hasCompletedProfile: true,
        };
        next();
    },
}));

jest.mock('../models/Course', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/UserCourseProgress', () => ({
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/Post', () => ({
    create: jest.fn(),
}));

const Course = require('../models/Course');
const UserCourseProgress = require('../models/UserCourseProgress');
const Post = require('../models/Post');

describe('academy flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns empty published courses safely without 500', async () => {
        Course.find.mockReturnValue({
            sort: () => ({
                skip: () => ({
                    limit: () => ({
                        lean: async () => [],
                    }),
                }),
            }),
        });
        Course.countDocuments.mockResolvedValue(0);

        const app = express();
        app.use(express.json());
        app.use('/api/academy', require('../routes/academyRoutes'));

        const res = await request(app).get('/api/academy/courses').expect(200);
        expect(res.body.courses).toEqual([]);
        expect(res.body.total).toBe(0);
    });

    it('enforces role-based create and allows employer create', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/academy', require('../routes/academyRoutes'));

        await request(app)
            .post('/api/academy/courses')
            .set('x-role', 'worker')
            .send({ title: 'Operations 101' })
            .expect(403);

        Course.create.mockResolvedValue({
            _id: '507f191e810c19729de860ea',
            title: 'Operations 101',
            description: '',
            modules: [],
            level: 'beginner',
            duration: '2h',
            createdAt: new Date(),
            updatedAt: new Date(),
            toObject() {
                return this;
            },
        });
        Post.create.mockResolvedValue({});

        await request(app)
            .post('/api/academy/courses')
            .set('x-role', 'employer')
            .send({ title: 'Operations 101' })
            .expect(201);

        expect(Course.create).toHaveBeenCalled();
    });

    it('rejects invalid course id and handles enrollment payload', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/academy', require('../routes/academyRoutes'));

        await request(app)
            .get('/api/academy/courses/not-an-id')
            .expect(400);

        Course.findById.mockResolvedValue({
            _id: '507f191e810c19729de860ea',
            title: 'Ops',
            description: '',
            modules: [],
            level: 'beginner',
            duration: '2h',
            isPublished: true,
            toObject() {
                return this;
            },
        });
        UserCourseProgress.findOneAndUpdate.mockResolvedValue({
            _id: 'progress-1',
            courseId: '507f191e810c19729de860ea',
            userId: 'user-1',
            completedLessonIds: [],
            progressPercent: 0,
            save: jest.fn().mockResolvedValue(null),
        });

        await request(app)
            .post('/api/academy/courses/507f191e810c19729de860ea/enroll')
            .expect(201);
    });
});
