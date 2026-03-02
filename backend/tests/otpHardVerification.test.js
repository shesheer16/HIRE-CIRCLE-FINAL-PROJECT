const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockSentCodesByEmail = new Map();

jest.mock('../utils/sendEmail', () => {
        const fn = jest.fn(async ({ email, message }) => {
            const code = String(message || '').match(/\b(\d{6})\b/)?.[1] || null;
            if (code) {
                mockSentCodesByEmail.set(String(email || '').toLowerCase(), code);
            }
            return { accepted: [email] };
        });
    fn.hasSmtpConfig = () => true;
    return fn;
});

jest.mock('../utils/sendSms', () => {
    const fn = jest.fn(async () => ({ ok: true }));
    fn.hasSmsConfig = () => true;
    return fn;
});

jest.setTimeout(30000);

describe('OTP hard verification', () => {
    let mongod;
    let app;
    let User;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'otp_test_secret_32_chars_minimum_length_here';
        process.env.OTP_EXPIRY_MS = '1000';
        process.env.OTP_RESEND_COOLDOWN_MS = '30000';
        process.env.OTP_MAX_VERIFY_ATTEMPTS = '5';
        process.env.OTP_MAX_REQUESTS_PER_WINDOW = '3';
        process.env.OTP_REQUEST_WINDOW_MS = '120000';
        process.env.OTP_BLOCK_WINDOW_MS = '120000';
        process.env.OTP_SEND_RATE_LIMIT_PER_IDENTITY = '20';
        process.env.OTP_VERIFY_RATE_LIMIT_PER_IDENTITY = '50';

        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri('hire-otp-hard-tests'));

        const router = require('../routes/authRoutes');
        User = require('../models/userModel');
        app = express();
        app.use(express.json());
        app.use('/api/auth', router);
    });

    beforeEach(async () => {
        mockSentCodesByEmail.clear();
        await User.deleteMany({});
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

    const createOtpUser = async (email) => User.create({
        name: email.split('@')[0],
        email,
        password: 'Password123!',
        role: 'candidate',
        activeRole: 'worker',
        primaryRole: 'worker',
        hasSelectedRole: true,
        isVerified: false,
        isEmailVerified: false,
    });

    it('simulates 10 OTP requests within 2 minutes and enforces rate limits', async () => {
        const email = 'burst.otp@test.com';
        await createOtpUser(email);

        const statuses = [];
        for (let i = 0; i < 10; i += 1) {
            const res = await request(app)
                .post('/api/auth/send-otp')
                .send({ email });
            statuses.push(res.statusCode);

            // Move last sent time back to bypass cooldown and isolate rate-limit behavior.
            await User.updateOne(
                { email },
                {
                    $set: {
                        otpLastSentAt: new Date(Date.now() - 60 * 1000),
                    },
                }
            );
        }

        expect(statuses.filter((code) => code === 200).length).toBeGreaterThan(0);
        expect(statuses.filter((code) => code === 429).length).toBeGreaterThan(0);
    });

    it('enforces resend cooldown and returns retryAfterMs', async () => {
        const email = 'resend.otp@test.com';
        await createOtpUser(email);

        await request(app)
            .post('/api/auth/send-otp')
            .send({ email })
            .expect(200);

        const resend = await request(app)
            .post('/api/auth/resend-otp')
            .send({ email })
            .expect(429);

        expect(Number(resend.body.retryAfterMs || 0)).toBeGreaterThan(0);
    });

    it('rejects expired OTP usage and blocks brute force after 5 wrong attempts', async () => {
        const email = 'verify.otp@test.com';
        await createOtpUser(email);

        await request(app)
            .post('/api/auth/send-otp')
            .send({ email })
            .expect(200);

        const correctCode = mockSentCodesByEmail.get(email);
        expect(correctCode).toBeTruthy();

        await User.updateOne(
            { email },
            {
                $set: {
                    otpExpiry: new Date(Date.now() - 1000),
                },
            }
        );

        await request(app)
            .post('/api/auth/verify-otp')
            .send({ email, otp: correctCode })
            .expect(400);

        await User.updateOne(
            { email },
            {
                $set: {
                    otpBlockedUntil: null,
                    otpRequestWindowStartedAt: new Date(Date.now() - 60 * 1000),
                    otpRequestCount: 0,
                    otpLastSentAt: new Date(Date.now() - 60 * 1000),
                },
            }
        );

        await request(app)
            .post('/api/auth/send-otp')
            .send({ email })
            .expect(200);

        for (let i = 0; i < 5; i += 1) {
            await request(app)
                .post('/api/auth/verify-otp')
                .send({ email, otp: '000000' })
                .expect(400);
        }

        await request(app)
            .post('/api/auth/verify-otp')
            .send({ email, otp: '111111' })
            .expect(429);
    });
});
