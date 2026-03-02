const express = require('express');
const request = require('supertest');

const { createRedisRateLimiter, readIp } = require('../services/redisRateLimiter');

jest.setTimeout(30000);

describe('abuse and rate-limit defenses', () => {
    let app;

    beforeEach(() => {
        const namespaceSeed = `${Date.now()}-${Math.random()}`;
        app = express();
        app.use(express.json());

        app.post('/login', createRedisRateLimiter({
            namespace: `test-login-${namespaceSeed}`,
            windowMs: 60 * 1000,
            max: 5,
            keyGenerator: (req) => readIp(req),
            message: 'Too many login attempts',
        }), (_req, res) => res.status(200).json({ ok: true }));

        app.post('/otp', createRedisRateLimiter({
            namespace: `test-otp-${namespaceSeed}`,
            windowMs: 2 * 60 * 1000,
            max: 3,
            keyGenerator: (req) => readIp(req),
            message: 'Too many OTP requests',
        }), (_req, res) => res.status(200).json({ ok: true }));

        app.post('/chat', createRedisRateLimiter({
            namespace: `test-chat-${namespaceSeed}`,
            windowMs: 60 * 1000,
            max: 20,
            keyGenerator: (req) => readIp(req),
            message: 'Too many messages',
        }), (_req, res) => res.status(200).json({ ok: true }));

        app.get('/api', createRedisRateLimiter({
            namespace: `test-api-${namespaceSeed}`,
            windowMs: 60 * 1000,
            max: 5,
            keyGenerator: (req) => readIp(req),
            message: 'Too many requests',
        }), (_req, res) => res.status(200).json({ ok: true }));
    });

    it('throttles login, OTP, chat burst, and high-volume API abuse patterns', async () => {
        const loginStatuses = [];
        for (let index = 0; index < 100; index += 1) {
            const response = await request(app).post('/login').send({ email: 'burst@test.com' });
            loginStatuses.push(response.statusCode);
        }
        expect(loginStatuses.filter((code) => code === 429).length).toBeGreaterThan(0);

        const otpStatuses = [];
        for (let index = 0; index < 50; index += 1) {
            const response = await request(app).post('/otp').send({ email: 'otp@test.com' });
            otpStatuses.push(response.statusCode);
        }
        expect(otpStatuses.filter((code) => code === 429).length).toBeGreaterThan(0);

        const chatStatuses = [];
        for (let index = 0; index < 100; index += 1) {
            const response = await request(app).post('/chat').send({ text: `message-${index + 1}` });
            chatStatuses.push(response.statusCode);
        }
        expect(chatStatuses.filter((code) => code === 429).length).toBeGreaterThan(0);

        const apiStatuses = [];
        for (let index = 0; index < 200; index += 1) {
            const response = await request(app).get('/api');
            apiStatuses.push(response.statusCode);
        }
        expect(apiStatuses.filter((code) => code === 429).length).toBeGreaterThan(0);
    });

    it('does not allow header-spoofed x-forwarded-for bypass when trust proxy is disabled', async () => {
        const statuses = [];
        for (let index = 0; index < 8; index += 1) {
            const response = await request(app)
                .get('/api')
                .set('x-forwarded-for', `203.0.113.${index + 10}`);
            statuses.push(response.statusCode);
        }

        expect(statuses.slice(0, 5).every((code) => code === 200)).toBe(true);
        expect(statuses.slice(5).some((code) => code === 429)).toBe(true);
    });
});
