const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { protect, employer } = require('../middleware/authMiddleware');
const { sendRequest } = require('../controllers/applicationController');
const { getChatHistory } = require('../controllers/chatController');
const { generateToken } = require('../utils/generateToken');

jest.setTimeout(30000);

const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

describe('authorization escalation and IDOR defenses', () => {
    let mongod;
    let app;

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
        otpVerified: true,
        profileComplete: true,
    });

    const createWorkerProfile = async (user, label) => WorkerProfile.create({
        user: user._id,
        firstName: label,
        lastName: 'User',
        city: 'Hyderabad',
        totalExperience: 2,
        roleProfiles: [{
            roleName: 'General',
            experienceInRole: 2,
            expectedSalary: 25000,
            skills: ['communication'],
        }],
    });

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_chars_minimum_value';
        process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32_chars_min_value';
        process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'otp_hmac_secret_32_chars_minimum_value';

        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-authorization-escalation-tests'));

        app = express();
        app.use(express.json());
        app.post('/employer-only', protect, employer, (_req, res) => res.status(200).json({ success: true }));
        app.post('/applications', protect, sendRequest);
        app.get('/chat/:applicationId', protect, getChatHistory);
    });

    beforeEach(async () => {
        await Promise.all(
            Object.values(mongoose.connection.collections || {}).map((collection) => collection.deleteMany({}))
        );
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

    it('blocks role escalation, userId spoofing, and cross-user chat access', async () => {
        const employerA = await createUser({
            email: 'employer.a@test.com',
            role: 'recruiter',
            activeRole: 'employer',
        });
        const employerB = await createUser({
            email: 'employer.b@test.com',
            role: 'recruiter',
            activeRole: 'employer',
        });
        const workerA = await createUser({ email: 'worker.a@test.com' });
        const workerB = await createUser({ email: 'worker.b@test.com' });

        const workerProfileA = await createWorkerProfile(workerA, 'WorkerA');
        const workerProfileB = await createWorkerProfile(workerB, 'WorkerB');

        const jobOwnedByEmployerA = await Job.create({
            employerId: employerA._id,
            title: 'Picker',
            companyName: 'Hire Labs',
            salaryRange: '12000-18000',
            location: 'Hyderabad',
            requirements: ['reliability'],
            status: 'active',
            isOpen: true,
        });

        const workerToken = generateToken(workerA._id, { tokenVersion: resolveTokenVersion(workerA.tokenVersion) });
        const otherWorkerToken = generateToken(workerB._id, { tokenVersion: resolveTokenVersion(workerB.tokenVersion) });
        const employerBToken = generateToken(employerB._id, { tokenVersion: resolveTokenVersion(employerB.tokenVersion) });

        const res = await request(app)
            .post('/employer-only')
            .set('Authorization', `Bearer ${workerToken}`)
            .send({ role: 'recruiter' });
        // Gating middleware intercepts and returns 403 on arbitrary requests if role profiles are missing.
        // We evaluate specifically the auth bypass, so we only care it's denied (401 or 403).
        expect([401, 403]).toContain(res.status);

        await request(app)
            .post('/applications')
            .set('Authorization', `Bearer ${otherWorkerToken}`)
            .send({
                jobId: String(jobOwnedByEmployerA._id),
                workerId: String(workerProfileA._id),
                initiatedBy: 'worker',
                userId: String(workerA._id),
                role: 'recruiter',
            })
            .expect(403);

        await request(app)
            .post('/applications')
            .set('Authorization', `Bearer ${employerBToken}`)
            .send({
                jobId: String(jobOwnedByEmployerA._id),
                workerId: String(workerProfileA._id),
                initiatedBy: 'employer',
                userId: String(employerA._id),
            })
            .expect(403);

        const allowedApplication = await Application.create({
            job: jobOwnedByEmployerA._id,
            worker: workerProfileA._id,
            employer: employerA._id,
            initiatedBy: 'worker',
            status: 'interview_requested',
            lastMessage: 'Applied',
        });

        await request(app)
            .get(`/chat/${String(allowedApplication._id)}`)
            .set('Authorization', `Bearer ${otherWorkerToken}`)
            .expect(403);

        const randomObjectId = new mongoose.Types.ObjectId();
        await request(app)
            .get(`/chat/${String(randomObjectId)}`)
            .set('Authorization', `Bearer ${generateToken(workerProfileB.user, { tokenVersion: resolveTokenVersion(workerB.tokenVersion) })}`)
            .expect(200);
    });
});
