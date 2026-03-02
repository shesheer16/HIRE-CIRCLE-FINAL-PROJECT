const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(20000);

describe('Auth API Endpoints', () => {
    let mongod;
    let app;
    let server;
    let io;
    let mongoose;
    let User;

    const testUser = {
        name: 'Test Employer',
        email: 'testemployer@example.com',
        password: 'Password123!',
        phoneNumber: '+15551234567',
    };

    const waitForConnection = async () => new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) {
            resolve();
            return;
        }
        const timeout = setTimeout(() => {
            reject(new Error('Mongo test connection timeout'));
        }, 10000);

        mongoose.connection.once('connected', () => {
            clearTimeout(timeout);
            resolve();
        });
        mongoose.connection.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.TEST_WITH_DB = 'true';
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_chars_minimum_value';
        process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32_chars_min_value';
        process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test_otp_hmac_secret_32_chars_minimum_value';
        process.env.PLATFORM_ENCRYPTION_SECRET = process.env.PLATFORM_ENCRYPTION_SECRET || 'platform_encryption_secret_32_chars_value';
        process.env.API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'http://localhost:5001';
        process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:19006';

        mongod = await MongoMemoryServer.create();
        process.env.MONGO_URI = mongod.getUri('hirecircle-auth-tests');

        jest.resetModules();
        ({ app, server, io } = require('../index'));
        mongoose = require('mongoose');
        User = require('../models/userModel');

        await waitForConnection();
    });

    beforeEach(async () => {
        await User.deleteMany({});
    });

    afterAll(async () => {
        if (mongoose?.connection?.readyState === 1) {
            await mongoose.connection.dropDatabase();
            await mongoose.connection.close();
        }

        if (io) {
            await new Promise((resolve) => io.close(resolve));
        }

        if (server?.listening) {
            await new Promise((resolve) => server.close(resolve));
        }

        if (mongod) {
            await mongod.stop();
        }
    });

    it('registers a new user successfully', async () => {
        const res = await request(app)
            .post('/api/users/register')
            .send(testUser);

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('_id');
        expect(res.body.email).toBe(testUser.email);
        expect(res.body.requiresOtpVerification).toBe(true);
        expect(res.body.activeRole).toBe('worker');
        expect(Array.isArray(res.body.roles)).toBe(true);
        expect(res.body.roles).toEqual(expect.arrayContaining(['worker', 'employer']));
        expect(res.body.token).toBeUndefined();
    });

    it('authenticates a user and returns access plus refresh tokens', async () => {
        await request(app)
            .post('/api/users/register')
            .send(testUser)
            .expect(201);

        const createdUser = await User.findOne({ email: testUser.email });
        createdUser.isVerified = true;
        createdUser.isEmailVerified = true;
        await createdUser.save();

        const loginRes = await request(app)
            .post('/api/users/login')
            .send({
                email: testUser.email,
                password: testUser.password,
            });

        expect(loginRes.statusCode).toBe(200);
        expect(loginRes.body.email).toBe(testUser.email);
        expect(typeof loginRes.body.token).toBe('string');
        expect(typeof loginRes.body.refreshToken).toBe('string');
    });
});
