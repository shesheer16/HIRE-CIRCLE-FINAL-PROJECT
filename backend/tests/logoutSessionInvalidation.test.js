const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.setTimeout(25000);

describe('logout + session invalidation', () => {
    let mongod;
    let app;
    let server;
    let io;
    let mongoose;
    let User;
    let sessionService;

    const userPayload = {
        name: 'Session User',
        email: 'session.user@example.com',
        password: 'Password123!',
        phoneNumber: '+15550001111',
    };

    const waitForConnection = async () => new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) {
            resolve();
            return;
        }
        const timeout = setTimeout(() => reject(new Error('Mongo connection timeout')), 10000);
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
        process.env.MONGO_URI = mongod.getUri('hire-logout-session-tests');

        jest.resetModules();
        ({ app, server, io } = require('../index'));
        mongoose = require('mongoose');
        User = require('../models/userModel');
        sessionService = require('../services/sessionService');
        await waitForConnection();
    });

    beforeEach(async () => {
        await User.deleteMany({});
    });

    afterEach(async () => {
        sessionService.setSocketIoServer(null);
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

    it('revokes tokens, clears socket sessions, marks device session, and blocks post-logout API usage', async () => {
        await request(app)
            .post('/api/users/register')
            .send(userPayload)
            .expect(201);

        const user = await User.findOne({ email: userPayload.email });
        user.isVerified = true;
        user.isEmailVerified = true;
        await user.save();

        const loginRes = await request(app)
            .post('/api/users/login')
            .set('x-device-id', 'device-A')
            .set('x-device-platform', 'mobile')
            .send({
                email: userPayload.email,
                password: userPayload.password,
            })
            .expect(200);

        const refreshRes = await request(app)
            .post('/api/users/refresh-token')
            .set('x-device-id', 'device-B')
            .set('x-device-platform', 'mobile')
            .send({ refreshToken: loginRes.body.refreshToken })
            .expect(200);

        const socketA = { disconnect: jest.fn() };
        const socketB = { disconnect: jest.fn() };
        const fakeIo = {
            sockets: {
                sockets: new Map([
                    ['socket-A', socketA],
                    ['socket-B', socketB],
                ]),
            },
        };

        sessionService.setSocketIoServer(fakeIo);
        await sessionService.registerSocketSession({ userId: user._id, socketId: 'socket-A' });
        await sessionService.registerSocketSession({ userId: user._id, socketId: 'socket-B' });

        const logoutRes = await request(app)
            .post('/api/users/logout')
            .set('Authorization', `Bearer ${refreshRes.body.token}`)
            .set('x-device-id', 'device-A')
            .set('x-device-platform', 'mobile')
            .send({ refreshToken: refreshRes.body.refreshToken })
            .expect(200);

        expect(logoutRes.body.success).toBe(true);
        expect(Number(logoutRes.body.revokedTokens || 0)).toBeGreaterThanOrEqual(2);
        expect(Number(logoutRes.body.revokedDeviceSessions || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(logoutRes.body.disconnectedSockets || 0)).toBe(2);
        expect(socketA.disconnect).toHaveBeenCalledWith(true);
        expect(socketB.disconnect).toHaveBeenCalledWith(true);

        const updatedUser = await User.findOne({ email: userPayload.email }).lean();
        const deviceA = (updatedUser.deviceSessions || []).find((row) => row.deviceId === 'device-A');
        const deviceB = (updatedUser.deviceSessions || []).find((row) => row.deviceId === 'device-B');
        expect(deviceA?.revokedAt).toBeTruthy();
        expect(deviceB?.revokedAt).toBeTruthy();

        await request(app)
            .post('/api/users/refresh-token')
            .send({ refreshToken: refreshRes.body.refreshToken })
            .expect(401);

        await request(app)
            .get('/api/settings')
            .set('Authorization', `Bearer ${refreshRes.body.token}`)
            .expect(401);
    });
});
