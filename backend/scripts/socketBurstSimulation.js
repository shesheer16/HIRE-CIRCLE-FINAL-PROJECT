/* eslint-disable no-console */
require('dotenv').config();
const crypto = require('crypto');
const randomSecret = () => crypto.randomBytes(32).toString('hex');

process.env.NODE_ENV = 'test';
process.env.TEST_WITH_DB = 'true';
process.env.REDIS_ENABLED = 'false';
if (!String(process.env.JWT_SECRET || '').trim() || String(process.env.JWT_SECRET).includes('<')) {
    process.env.JWT_SECRET = randomSecret();
}
if (!String(process.env.JWT_REFRESH_SECRET || '').trim() || String(process.env.JWT_REFRESH_SECRET).includes('<')) {
    process.env.JWT_REFRESH_SECRET = randomSecret();
}
if (!String(process.env.OTP_HMAC_SECRET || '').trim() || String(process.env.OTP_HMAC_SECRET).includes('<')) {
    process.env.OTP_HMAC_SECRET = randomSecret();
}
if (!String(process.env.CORS_ORIGINS || '').trim()) {
    process.env.CORS_ORIGINS = 'http://127.0.0.1:19006';
}
if (!String(process.env.AWS_SQS_INTERVIEW_QUEUE_URL || '').trim()) {
    process.env.AWS_SQS_INTERVIEW_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/socket-burst-test';
}
if (!String(process.env.SMART_INTERVIEW_DATASET_SALT || '').trim() || String(process.env.SMART_INTERVIEW_DATASET_SALT).includes('<')) {
    process.env.SMART_INTERVIEW_DATASET_SALT = randomSecret();
}

const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const redisClient = require('../config/redis');
const { signAccessToken } = require('../utils/tokenService');

let server;
let mongoMemoryServer = null;

// Reuse installed client from mobile app workspace.
const { io: ioClient } = require(path.join(__dirname, '../../mobile-app/node_modules/socket.io-client'));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signToken = (userDoc) => signAccessToken(userDoc._id, {
    tokenVersion: Number.parseInt(userDoc?.tokenVersion, 10) || 0,
});

const connectSocket = ({ baseUrl, token }) => {
    return new Promise((resolve, reject) => {
        const socket = ioClient(baseUrl, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 5000,
            auth: token ? { token } : {},
        });

        const cleanup = () => {
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
        };

        const onConnect = () => {
            cleanup();
            resolve(socket);
        };

        const onError = (error) => {
            cleanup();
            reject(error);
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onError);
    });
};

const createFixture = async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const workerUser = await User.create({
        name: `Socket Worker ${suffix}`,
        email: `socket-worker-${suffix}@example.com`,
        password: 'StrongPass!123',
        role: 'candidate',
        hasCompletedProfile: true,
    });

    const employerUser = await User.create({
        name: `Socket Employer ${suffix}`,
        email: `socket-employer-${suffix}@example.com`,
        password: 'StrongPass!123',
        role: 'recruiter',
        hasCompletedProfile: true,
    });

    const workerProfile = await WorkerProfile.create({
        user: workerUser._id,
        firstName: 'Socket',
        lastName: 'Worker',
        city: 'hyderabad',
        totalExperience: 3,
        preferredShift: 'Flexible',
        roleProfiles: [
            {
                roleName: 'driver',
                experienceInRole: 3,
                expectedSalary: 22000,
                skills: ['driving', 'route planning'],
            },
        ],
        isAvailable: true,
    });

    const job = await Job.create({
        employerId: employerUser._id,
        title: 'Driver',
        companyName: 'Socket Co',
        salaryRange: '20000-25000',
        location: 'hyderabad',
        requirements: ['driving'],
        minSalary: 20000,
        maxSalary: 25000,
        shift: 'Flexible',
        isOpen: true,
        status: 'active',
    });

    const application = await Application.create({
        job: job._id,
        worker: workerProfile._id,
        employer: employerUser._id,
        initiatedBy: 'worker',
        status: 'accepted',
    });

    return {
        workerUser,
        employerUser,
        workerProfile,
        job,
        application,
    };
};

const cleanupFixture = async (fixture) => {
    if (!fixture) return;
    await Promise.all([
        Application.deleteOne({ _id: fixture.application._id }),
        Job.deleteOne({ _id: fixture.job._id }),
        WorkerProfile.deleteOne({ _id: fixture.workerProfile._id }),
        User.deleteOne({ _id: fixture.workerUser._id }),
        User.deleteOne({ _id: fixture.employerUser._id }),
    ]);
};

const run = async () => {
    let fixture;
    let socketWorker;
    let socketEmployer;
    let runError = null;
    let report = null;

    try {
        const configuredMongoUri = String(process.env.MONGO_URI || '').trim();
        const forceInMemoryMongo = String(process.env.SOCKET_BURST_FORCE_IN_MEMORY || 'true').toLowerCase() !== 'false';
        const needsInMemoryMongo = forceInMemoryMongo || !configuredMongoUri || configuredMongoUri.includes('<');
        if (needsInMemoryMongo) {
            const { MongoMemoryServer } = require('mongodb-memory-server');
            mongoMemoryServer = await MongoMemoryServer.create();
            process.env.MONGO_URI = mongoMemoryServer.getUri('hirecircle_socket_burst');
        }

        ({ server } = require('../index'));

        await new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 3000;
        const baseUrl = `http://127.0.0.1:${port}`;

        fixture = await createFixture();

        const workerToken = signToken(fixture.workerUser);
        const employerToken = signToken(fixture.employerUser);

        const counters = {
            unauthorizedConnectRejected: false,
            unauthorizedJoinRejected: 0,
            messageFailedCount: 0,
            workerMessagesReceived: 0,
            employerMessagesReceived: 0,
            typingEventsSeen: 0,
            readAckEventsSeen: 0,
        };

        try {
            await connectSocket({ baseUrl, token: null });
            counters.unauthorizedConnectRejected = false;
        } catch (_error) {
            counters.unauthorizedConnectRejected = true;
        }

        socketWorker = await connectSocket({ baseUrl, token: workerToken });
        socketEmployer = await connectSocket({ baseUrl, token: employerToken });
        let awaitingUnauthorizedJoinError = false;

        socketWorker.on('messageFailed', ({ error }) => {
            counters.messageFailedCount += 1;
            if (awaitingUnauthorizedJoinError) {
                counters.unauthorizedJoinRejected += 1;
                awaitingUnauthorizedJoinError = false;
            }
        });
        socketEmployer.on('messageFailed', () => {
            counters.messageFailedCount += 1;
        });

        socketWorker.on('new_message', () => {
            counters.workerMessagesReceived += 1;
        });
        socketEmployer.on('new_message', () => {
            counters.employerMessagesReceived += 1;
        });

        const typingHandler = () => {
            counters.typingEventsSeen += 1;
        };
        const readAckHandler = () => {
            counters.readAckEventsSeen += 1;
        };

        socketWorker.on('user_typing', typingHandler);
        socketEmployer.on('user_typing', typingHandler);
        socketWorker.on('messages_read_ack', readAckHandler);
        socketEmployer.on('messages_read_ack', readAckHandler);

        const applicationId = String(fixture.application._id);
        const randomId = new mongoose.Types.ObjectId().toString();

        socketWorker.emit('join_chat', { applicationId });
        socketEmployer.emit('join_chat', { applicationId });
        awaitingUnauthorizedJoinError = true;
        socketWorker.emit('join_chat', { applicationId: randomId });
        await wait(250);

        for (let i = 0; i < 35; i += 1) {
            socketWorker.emit('sendMessage', {
                applicationId,
                text: `burst-msg-${i}`,
                clientMessageId: `worker-${i}`,
            });
        }

        for (let i = 0; i < 45; i += 1) {
            socketWorker.emit('typing', { roomId: applicationId });
            socketWorker.emit('stop_typing', { roomId: applicationId });
            socketEmployer.emit('typing', { roomId: applicationId });
        }

        socketEmployer.emit('messages_read', { roomId: applicationId });

        // Simulate network drop/reconnect for employer.
        socketEmployer.disconnect();
        await wait(300);
        socketEmployer = await connectSocket({ baseUrl, token: employerToken });
        socketEmployer.on('new_message', () => {
            counters.employerMessagesReceived += 1;
        });
        socketEmployer.on('messageFailed', () => {
            counters.messageFailedCount += 1;
        });
        socketEmployer.on('user_typing', typingHandler);
        socketEmployer.on('messages_read_ack', readAckHandler);
        socketEmployer.emit('join_chat', { applicationId });
        socketEmployer.emit('sendMessage', {
            applicationId,
            text: 'post-reconnect-message',
            clientMessageId: 'employer-reconnect-1',
        });

        await wait(2000);

        report = {
            users: 2,
            burstMessagesAttempted: 35,
            unauthorizedConnectRejected: counters.unauthorizedConnectRejected,
            unauthorizedJoinRejected: counters.unauthorizedJoinRejected > 0,
            messageFailuresObserved: counters.messageFailedCount,
            workerMessagesReceived: counters.workerMessagesReceived,
            employerMessagesReceived: counters.employerMessagesReceived,
            typingEventsSeen: counters.typingEventsSeen,
            readAckEventsSeen: counters.readAckEventsSeen,
            reconnectCompleted: Boolean(socketEmployer?.connected),
            rateLimitTriggered: counters.messageFailedCount > 0,
        };
    } catch (error) {
        runError = error;
    } finally {
        if (socketWorker) socketWorker.disconnect();
        if (socketEmployer) socketEmployer.disconnect();
        await cleanupFixture(fixture).catch(() => {});
        if (server?.listening) {
            await new Promise((resolve) => server.close(() => resolve()));
        }
        if (redisClient?.isOpen && typeof redisClient.quit === 'function') {
            await redisClient.quit().catch(() => {});
        }
        if (typeof redisClient?.disconnect === 'function') {
            await redisClient.disconnect().catch(() => {});
        }
        await mongoose.connection.close().catch(() => {});
        if (mongoMemoryServer) {
            await mongoMemoryServer.stop().catch(() => {});
        }
    }

    if (runError) {
        throw runError;
    }

    return report;
};

run()
    .then((result) => {
        process.stdout.write(`${JSON.stringify(result || {})}\n`);
        process.exit(0);
    })
    .catch((error) => {
        process.stderr.write(`${JSON.stringify({
            level: 'error',
            message: error?.message || String(error),
            timestamp: new Date().toISOString(),
        })}\n`);
        process.exit(1);
    });
