const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/userModel');
const Job = require('../models/Job');
const Post = require('../models/Post');
const Message = require('../models/Message');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const { protect, employer } = require('../middleware/authMiddleware');
const { requestSanitizer } = require('../middleware/requestSanitizer');
const { createJob } = require('../controllers/jobController');
const { sendMessageREST } = require('../controllers/chatController');
const { generateToken } = require('../utils/generateToken');
const { sanitizeText } = require('../utils/sanitizeText');

jest.setTimeout(30000);

const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

describe('injection and XSS guards', () => {
    let mongod;
    let app;
    let employerUser;
    let workerUser;
    let workerProfile;
    let chatApplication;
    let employerToken;
    let workerToken;

    const createUser = async ({
        email,
        role = 'candidate',
        activeRole = 'worker',
    }) => User.create({
        name: email.split('@')[0],
        email,
        password: 'Password123!',
        role,
        activeRole,
        primaryRole: activeRole,
        hasSelectedRole: true,
        hasCompletedProfile: true,
        isVerified: true,
        isEmailVerified: true,
    });

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_chars_minimum_value';
        process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32_chars_min_value';
        process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'otp_hmac_secret_32_chars_minimum_value';

        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-injection-xss-tests'));

        app = express();
        app.use(express.json());
        app.post('/feed/posts', protect, async (req, res) => {
            try {
                const created = await Post.create({
                    user: req.user._id,
                    authorId: req.user._id,
                    type: 'text',
                    postType: 'status',
                    content: sanitizeText(req.body?.content || '', { maxLength: 5000 }),
                    visibility: 'public',
                    media: [],
                    mediaUrl: '',
                    location: {
                        type: 'Point',
                        coordinates: [0, 0],
                    },
                });
                return res.status(201).json({ post: created });
            } catch (error) {
                return res.status(500).json({ message: error.message, stack: error.stack });
            }
        });
        app.post('/jobs', protect, employer, createJob);
        app.post('/chat/send', protect, sendMessageREST);
        app.post('/sanitize-check', requestSanitizer, (req, res) => res.status(200).json(req.body));
    });

    beforeEach(async () => {
        await Promise.all(
            Object.values(mongoose.connection.collections || {}).map((collection) => collection.deleteMany({}))
        );

        employerUser = await createUser({
            email: 'xss.employer@test.com',
            role: 'recruiter',
            activeRole: 'employer',
        });
        workerUser = await createUser({
            email: 'xss.worker@test.com',
            role: 'candidate',
            activeRole: 'worker',
        });

        workerProfile = await WorkerProfile.create({
            user: workerUser._id,
            firstName: 'Worker',
            lastName: 'User',
            city: 'Hyderabad',
            totalExperience: 2,
            roleProfiles: [{
                roleName: 'General',
                experienceInRole: 2,
                expectedSalary: 20000,
                skills: ['communication'],
            }],
        });
        await EmployerProfile.create({
            user: employerUser._id,
            companyName: 'Hire Labs',
            logoUrl: 'https://assets.example.com/logo.png',
            description: 'Hiring operations workforce',
            industry: 'Operations',
            location: 'Hyderabad',
            contactPerson: 'Hiring Lead',
        });

        const seededJob = await Job.create({
            employerId: employerUser._id,
            title: 'Picker',
            companyName: 'Hire Labs',
            salaryRange: '12000-18000',
            location: 'Hyderabad',
            requirements: ['reliability'],
            status: 'active',
            isOpen: true,
        });

        chatApplication = await Application.create({
            job: seededJob._id,
            worker: workerProfile._id,
            employer: employerUser._id,
            initiatedBy: 'worker',
            status: 'interview_requested',
            lastMessage: 'Applied',
        });

        employerToken = generateToken(employerUser._id, { tokenVersion: resolveTokenVersion(employerUser.tokenVersion) });
        workerToken = generateToken(workerUser._id, { tokenVersion: resolveTokenVersion(workerUser.tokenVersion) });
    });

    afterAll(async () => {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.dropDatabase();
            await mongoose.connection.close();
        }
        if (mongod) {
            await mongod.stop();
        }
    });

    it('sanitizes post/chat/job content and strips NoSQL/prototype pollution payload keys', async () => {
        const feedRes = await request(app)
            .post('/feed/posts')
            .set('Authorization', `Bearer ${workerToken}`)
            .send({
                type: 'text',
                content: '<script>alert(1)</script> hello',
                lat: 17.4,
                lng: 78.4,
            });
        if (feedRes.statusCode !== 201) {
            throw new Error(`feed create failed: ${feedRes.statusCode} ${JSON.stringify(feedRes.body)}`);
        }

        const postId = String(feedRes.body?.post?._id || '');
        const persistedPost = await Post.findById(postId).lean();
        expect(String(persistedPost.content)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(String(persistedPost.content)).not.toContain('<script>');

        const chatRes = await request(app)
            .post('/chat/send')
            .set('Authorization', `Bearer ${workerToken}`)
            .send({
                applicationId: String(chatApplication._id),
                text: '<img src=x onerror=alert(1)> message',
            })
            .expect(201);

        const messageId = String(chatRes.body?._id || '');
        const persistedMessage = await Message.findById(messageId).lean();
        expect(String(persistedMessage.text)).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(String(persistedMessage.text)).not.toContain('<img');

        const jobRes = await request(app)
            .post('/jobs')
            .set('Authorization', `Bearer ${employerToken}`)
            .send({
                title: '<h1>Manager</h1>',
                companyName: '<script>Corp</script>',
                salaryRange: '<b>10000-20000</b>',
                location: '<iframe>Hyd</iframe>',
                requirements: ['<svg/onload=alert(1)>'],
                screeningQuestions: ['<img src=x onerror=alert(1)>'],
                shift: 'Flexible',
            })
            .expect(201);

        const persistedJob = await Job.findById(jobRes.body?.data?._id).lean();
        expect(String(persistedJob.title)).toContain('&lt;h1&gt;Manager&lt;/h1&gt;');
        expect(String(persistedJob.companyName)).toContain('&lt;script&gt;Corp&lt;/script&gt;');
        expect(String(persistedJob.location)).not.toContain('<iframe>');
        expect(String(persistedJob.requirements[0])).not.toContain('<svg');

        const sanitizeRes = await request(app)
            .post('/sanitize-check')
            .send({
                email: { $ne: null },
                $where: 'this.password',
                profile: {
                    '__proto__': { polluted: true },
                    'name.first': 'bad',
                    safe: 'ok',
                },
            })
            .expect(200);

        expect(Object.prototype.polluted).toBeUndefined();
        expect(sanitizeRes.body.$where).toBeUndefined();
        expect(sanitizeRes.body.profile?.['name.first']).toBeUndefined();
        expect(sanitizeRes.body.profile?.safe).toBe('ok');
        expect(sanitizeRes.body.email).toEqual({});
    });
});
