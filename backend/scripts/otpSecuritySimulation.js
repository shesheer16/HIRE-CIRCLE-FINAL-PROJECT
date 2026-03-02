/* eslint-disable no-console */
require('dotenv').config();
const crypto = require('crypto');

const randomSecret = () => crypto.randomBytes(32).toString('hex');

process.env.NODE_ENV = 'test';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || randomSecret();
process.env.OTP_RESEND_COOLDOWN_MS = '0';
process.env.OTP_MAX_REQUESTS_PER_WINDOW = '2';
process.env.OTP_MAX_VERIFY_ATTEMPTS = '3';
process.env.OTP_BLOCK_WINDOW_MS = String(5 * 60 * 1000);
process.env.OTP_SEND_RATE_LIMIT_PER_IDENTITY = '100';
process.env.OTP_VERIFY_RATE_LIMIT_PER_IDENTITY = '100';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '587';
process.env.SMTP_EMAIL = 'otp-test@hire.local';
process.env.SMTP_PASSWORD = 'otp-test-password';
process.env.FROM_EMAIL = 'no-reply@hire.local';
process.env.SMTP_SKIP_SEND = 'true';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_FROM_PHONE = '';

const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/userModel');
const authRoutes = require('../routes/authRoutes');

const run = async () => {
    let mongoServer;
    try {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri('hirecircle_otp_security_sim'));

        await User.create({
            name: 'OTP Rapid Sim User',
            email: 'otp.rapid@example.com',
            password: 'StrongPass!123',
            role: 'candidate',
            linkedAccounts: {
                emailPassword: true,
            },
        });
        await User.create({
            name: 'OTP Brute Sim User',
            email: 'otp.brute@example.com',
            password: 'StrongPass!123',
            role: 'candidate',
            linkedAccounts: {
                emailPassword: true,
            },
        });

        const app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);

        const identityPayload = { email: 'otp.rapid@example.com' };
        const sendStatuses = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await request(app)
                .post('/api/auth/send-otp')
                .send(identityPayload);
            sendStatuses.push(response.statusCode);
        }

        const bruteForcePayload = { email: 'otp.brute@example.com' };
        await request(app)
            .post('/api/auth/send-otp')
            .send(bruteForcePayload);

        const verifyStatuses = [];
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const response = await request(app)
                .post('/api/auth/verify-otp')
                .send({ ...bruteForcePayload, otp: '111111' });
            verifyStatuses.push(response.statusCode);
        }

        const rapidUserAfter = await User.findOne({ email: 'otp.rapid@example.com' }).lean();
        const bruteUserAfter = await User.findOne({ email: 'otp.brute@example.com' }).lean();

        console.log(JSON.stringify({
            sendOtpStatuses: sendStatuses,
            verifyOtpStatuses: verifyStatuses,
            rapidOtpRateLimitTriggered: sendStatuses[2] === 429,
            bruteForceBlocked: verifyStatuses[3] === 429,
            otpStoredHashed: Boolean(bruteUserAfter?.otpCodeHash),
            bruteOtpAttemptCount: Number(bruteUserAfter?.otpAttemptCount || 0),
            bruteOtpBlockedUntilSet: Boolean(bruteUserAfter?.otpBlockedUntil),
            rapidOtpBlockedUntilSet: Boolean(rapidUserAfter?.otpBlockedUntil),
        }, null, 2));
    } finally {
        await mongoose.connection.close().catch(() => {});
        if (mongoServer) {
            await mongoServer.stop().catch(() => {});
        }
    }
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
