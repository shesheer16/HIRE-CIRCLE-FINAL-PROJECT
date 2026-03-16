const crypto = require('crypto');
const request = require('supertest');
const { createMongoMemoryServer } = require('../utils/testMongoServer');

const mockSendEmail = jest.fn().mockResolvedValue(undefined);
mockSendEmail.hasSmtpConfig = jest.fn(() => true);

jest.mock('../utils/sendEmail', () => mockSendEmail);

jest.setTimeout(20000);

describe('Account recovery hardening', () => {
    let mongod;
    let app;
    let server;
    let io;
    let mongoose;
    let User;

    const testUser = {
        name: 'Recovery Tester',
        email: 'recovery@example.com',
        password: 'Password123!',
        phoneNumber: '+15551230000',
    };

    const waitForConnection = async () => new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) {
            resolve();
            return;
        }
        const timeout = setTimeout(() => reject(new Error('Mongo test connection timeout')), 10000);
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
        process.env.REDIS_ENABLED = 'false';
        process.env.JWT_SECRET = 'test_jwt_secret_32_chars_minimum_value';
        process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_chars_min_value';
        process.env.OTP_HMAC_SECRET = 'test_otp_hmac_secret_32_chars_minimum_value';
        process.env.PLATFORM_ENCRYPTION_SECRET = 'platform_encryption_secret_32_chars_value';
        process.env.GEMINI_API_KEY = 'gemini_test_key_abcdefghijklmnopqrstuvwxyz';
        process.env.API_PUBLIC_URL = 'http://localhost:5001';
        process.env.FRONTEND_URL = 'http://localhost:19006';

        mongod = await createMongoMemoryServer('hirecircle-recovery-tests');
        process.env.MONGO_URI = mongod.getUri('hirecircle-recovery-tests');

        jest.resetModules();
        ({ app, server, io } = require('../index'));
        mongoose = require('mongoose');
        User = require('../models/userModel');

        await waitForConnection();
    });

    beforeEach(async () => {
        mockSendEmail.mockClear();
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

    it('stores email verification tokens hashed while still accepting the raw verification link', async () => {
        const registerRes = await request(app)
            .post('/api/users/register')
            .send(testUser)
            .expect(201);

        expect(registerRes.body.requiresOtpVerification).toBe(true);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);

        const message = mockSendEmail.mock.calls[0][0]?.message || '';
        const match = message.match(/\/verifyemail\/([a-f0-9]+)/i);
        expect(match).toBeTruthy();
        const rawToken = match[1];

        const createdUser = await User.findOne({ email: testUser.email });
        expect(createdUser.verificationToken).toBeTruthy();
        expect(createdUser.verificationToken).not.toBe(rawToken);
        expect(createdUser.verificationToken).toBe(
            crypto.createHash('sha256').update(rawToken).digest('hex')
        );

        await request(app)
            .put(`/api/users/verifyemail/${rawToken}`)
            .expect(200);

        const verifiedUser = await User.findOne({ email: testUser.email });
        expect(verifiedUser.isVerified).toBe(true);
        expect(verifiedUser.isEmailVerified).toBe(true);
        expect(verifiedUser.otpVerified).toBe(true);
        expect(verifiedUser.verificationToken).toBeUndefined();
    });

    it('returns a generic forgot-password response for unknown accounts', async () => {
        const response = await request(app)
            .post('/api/users/forgotpassword')
            .send({ email: 'missing@example.com' })
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            data: 'If an account exists, a password reset link has been sent.',
        });
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('returns a generic resend-verification response for unknown accounts', async () => {
        const response = await request(app)
            .post('/api/users/resendverification')
            .send({ email: 'missing@example.com' })
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            data: 'If an unverified account exists, a verification email has been sent.',
        });
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('reissues verification links with hashed tokens for existing unverified accounts', async () => {
        const user = await User.create({
            name: 'Pending User',
            email: 'pending@example.com',
            password: 'Password123!',
            verificationToken: 'legacy-token',
            isVerified: false,
            otpVerified: false,
        });

        const response = await request(app)
            .post('/api/users/resendverification')
            .send({ email: user.email })
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            data: 'If an unverified account exists, a verification email has been sent.',
        });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);

        const message = mockSendEmail.mock.calls[0][0]?.message || '';
        const match = message.match(/\/verifyemail\/([a-f0-9]+)/i);
        expect(match).toBeTruthy();
        const rawToken = match[1];

        const refreshedUser = await User.findOne({ email: user.email });
        expect(refreshedUser.verificationToken).toBe(
            crypto.createHash('sha256').update(rawToken).digest('hex')
        );
    });
});
