const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const http = require('http');
const os = require('os');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const logger = require('./utils/logger');
const connectDB = require('./config/db');
const redisClient = require('./config/redis');
const { validateEnvironment } = require('./config/env');
const { startupIntegrityCheck } = require('./services/startupIntegrityService');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { protect } = require('./middleware/authMiddleware');
const { requestContextMiddleware } = require('./middleware/requestContext');
const { edgeCdnPolicyMiddleware } = require('./middleware/edgeCdnPolicyMiddleware');
const { requestSanitizer } = require('./middleware/requestSanitizer');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');
const Application = require('./models/Application');
const Message = require('./models/Message');
const CallSession = require('./models/CallSession');
const Job = require('./models/Job');
const User = require('./models/userModel');
const { trackFunnelStage } = require('./services/growthFunnelService');
const { recordFeatureUsage } = require('./services/monetizationIntelligenceService');
const { dispatchAsyncTask, TASK_TYPES } = require('./services/asyncTaskDispatcher');
const { getInterviewQueueDepth } = require('./services/sqsInterviewQueue');
const { getQueueDepth } = require('./services/distributedTaskQueue');
const { createRedisRateLimiter, readIp } = require('./services/redisRateLimiter');
const { installDatabaseSafetyGuards } = require('./services/queryPerformanceService');
const { mountServiceBoundaries } = require('./modules');
const { adaptiveLoadMiddleware } = require('./middleware/adaptiveLoadMiddleware');
const {
    attachRedisAdapterToSocketIo,
    consumeSocketRateLimit,
    rememberSocketMessageId,
} = require('./services/socketScalingService');
const {
    requestDrainMiddleware,
    registerGracefulShutdown,
    requestGracefulShutdown,
    isShuttingDown,
    getInFlightRequestCount,
} = require('./services/gracefulShutdownService');
const {
    markSocketConnected,
    markSocketDisconnected,
    getRuntimeSystemMetrics,
} = require('./services/runtimeMetricsService');
const {
    startSystemHealthMonitoring,
} = require('./services/systemHealthService');
const {
    startResourceWatchdog,
} = require('./services/resourceWatchdogService');
const {
    startRegionReplicationDispatcher,
    stopRegionReplicationDispatcher,
} = require('./services/regionReplicationService');
const {
    startGlobalScaleAutopilot,
    stopGlobalScaleAutopilot,
} = require('./services/globalScaleAutopilotService');
const { startExternalWorker, stopExternalWorker } = require('./services/externalWorkerService');
const { startExternalEventBridge, stopExternalEventBridge } = require('./services/externalEventBridgeService');
const { getFeatureFlag } = require('./services/featureFlagService');
const { safeLogPlatformEvent } = require('./services/eventLoggingService');
const { enqueueBackgroundJob } = require('./services/backgroundQueueService');
const { installConsoleBridge } = require('./utils/consoleBridge');
const { verifyAccessToken } = require('./utils/tokenService');
const { sanitizeText } = require('./utils/sanitizeText');
const {
    setSocketIoServer,
    registerSocketSession,
    unregisterSocketSession,
} = require('./services/sessionService');

dotenv.config();
installConsoleBridge();
installDatabaseSafetyGuards();

let envConfig;
try {
    envConfig = validateEnvironment();
    startupIntegrityCheck({ strict: true });
} catch (error) {
    logger.error(`FATAL: ${error.message}`);
    process.exit(1);
}

const runtime = envConfig.runtime;
const isProduction = envConfig.isProduction;
const isTestRuntime = envConfig.isTest;

if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        integrations: [nodeProfilingIntegration()],
        tracesSampleRate: Number(process.env.SENTRY_TRACE_SAMPLE_RATE || 0.2),
        profilesSampleRate: Number(process.env.SENTRY_PROFILE_SAMPLE_RATE || 0.2),
    });
}

if (isTestRuntime && String(process.env.TEST_WITH_DB || '').toLowerCase() !== 'true') {
    mongoose.set('bufferCommands', false);
    logger.info('Skipping DB bootstrap in test runtime');
} else {
    connectDB().catch((error) => {
        logger.error(`Database bootstrap failed: ${error.message}`);
        if (!isTestRuntime) {
            process.exit(1);
        }
    });
}

const app = express();
app.disable('x-powered-by');
app.use(requestContextMiddleware);
app.use(edgeCdnPolicyMiddleware);
app.use(requestDrainMiddleware);
if (isProduction) {
    app.enable('trust proxy');
}

const envOrigins = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const localOrigins = isProduction
    ? []
    : [
        'http://localhost:19006',
        'http://localhost:8081',
        'http://localhost:3000',
    ];
const allowedOrigins = Array.from(new Set([...localOrigins, ...envOrigins]));

const isAllowedOrigin = (origin) => {
    if (!origin) return true; // Native mobile/websocket clients may omit origin
    return allowedOrigins.includes(origin);
};

const allowInlineStyles = String(process.env.CSP_ALLOW_INLINE_STYLE || 'false').toLowerCase() === 'true';
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: allowInlineStyles ? ["'self'", "'unsafe-inline'"] : ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https:', 'wss:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: isProduction ? [] : null,
        },
    },
    hsts: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
}));

const apiLimiter = createRedisRateLimiter({
    namespace: 'api',
    windowMs: 15 * 60 * 1000,
    max: Number.parseInt(process.env.API_RATE_LIMIT_PER_WINDOW || '100', 10),
    keyGenerator: (req) => `${readIp(req)}:${String(req.user?._id || 'anonymous')}`,
    skip: () => isTestRuntime,
    strictRedis: isProduction,
    message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use('/api/', apiLimiter);

app.use(cors({
    origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('CORS policy restricted.'), false);
    },
    credentials: true,
}));
app.use(adaptiveLoadMiddleware);

if (isProduction) {
    app.use((req, res, next) => {
        if (req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
            return next();
        }
        return res.status(403).json({ message: 'HTTPS is required' });
    });
}

// Stripe webhook must stay before express.json middleware
app.use('/api/payment', require('./routes/paymentRoutes'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(requestSanitizer);

app.use(morgan(isProduction ? 'combined' : 'tiny', { stream: logger.stream }));

// Keep uploads private in production.
if (!isProduction) {
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// Secure export downloads to file owner only.
app.get('/exports/:filename', protect, (req, res) => {
    const requested = String(req.params.filename || '');
    const fileName = path.basename(requested);
    if (requested !== fileName) {
        return res.status(400).json({ message: 'Invalid export file name' });
    }

    const userId = String(req.user?._id || '');
    if (!fileName.includes(userId)) {
        return res.status(403).json({ message: 'Not authorized to access this export' });
    }

    const filePath = path.join(__dirname, 'exports', fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Export file not found' });
    }

    return res.sendFile(filePath);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { background-color: #9333ea; }',
    customSiteTitle: 'HireCircle API Docs',
}));

const getDbHealth = () => {
    const readyState = mongoose.connection.readyState;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const stateName = states[readyState] || 'unknown';
    return {
        status: readyState === 1 ? 'ok' : 'degraded',
        readyState,
        state: stateName,
        host: mongoose.connection.host || null,
        name: mongoose.connection.name || null,
    };
};

const getRedisHealth = () => {
    if (typeof redisClient.getHealth === 'function') {
        return redisClient.getHealth();
    }
    return {
        status: redisClient?.isOpen ? 'ok' : 'degraded',
        degraded: !redisClient?.isOpen,
    };
};

app.get('/metrics', async (_req, res) => {
    try {
        const [runtimeMetrics, jobsCount, applicationsCount, interviewQueueDepth, distributedQueueDepth] = await Promise.all([
            getRuntimeSystemMetrics(),
            Job.countDocuments({}),
            Application.countDocuments({}),
            getInterviewQueueDepth().catch(() => 0),
            getQueueDepth().catch(() => ({})),
        ]);

        const distributedDepth = Object.values(distributedQueueDepth || {})
            .reduce((sum, value) => sum + Number(value || 0), 0);

        res.status(200).json({
            activeConnections: Number(runtimeMetrics.activeConnections || io?.engine?.clientsCount || 0),
            activeUsers: Number(runtimeMetrics.activeUsers || 0),
            jobsCount: Number(jobsCount || 0),
            applicationsCount: Number(applicationsCount || 0),
            queueDepth: {
                interview: Number(interviewQueueDepth || 0),
                distributed: distributedQueueDepth,
                total: Number(interviewQueueDepth || 0) + distributedDepth,
            },
            memoryUsage: runtimeMetrics.memoryUsage || process.memoryUsage(),
            uptime: Number(runtimeMetrics.uptime || process.uptime()),
            cpuLoad: runtimeMetrics.cpuLoad || os.loadavg(),
            inFlightRequests: getInFlightRequestCount(),
            draining: isShuttingDown(),
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to collect metrics' });
    }
});

app.get('/health/memory', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        memory: process.memoryUsage(),
        rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
        heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
        uptimeSeconds: Number(process.uptime().toFixed(2)),
        timestamp: new Date().toISOString(),
    });
});

app.get('/health/db', (_req, res) => {
    const dbHealth = getDbHealth();
    res.status(dbHealth.status === 'ok' ? 200 : 503).json({
        service: 'db',
        ...dbHealth,
        timestamp: new Date().toISOString(),
    });
});

app.get('/health/redis', (_req, res) => {
    const redisHealth = getRedisHealth();
    res.status(redisHealth.status === 'ok' ? 200 : 503).json({
        service: 'redis',
        ...redisHealth,
        timestamp: new Date().toISOString(),
    });
});

app.get('/health/socket', (_req, res) => {
    res.status(200).json({
        service: 'socket',
        status: isShuttingDown() ? 'draining' : 'ok',
        connectedClients: io.engine.clientsCount,
        uptimeSeconds: Number(process.uptime().toFixed(2)),
        timestamp: new Date().toISOString(),
    });
});

app.get(['/api/health', '/health'], (_req, res) => {
    const dbHealth = getDbHealth();
    const redisHealth = getRedisHealth();
    const degraded = dbHealth.status !== 'ok' || redisHealth.status !== 'ok' || isShuttingDown();

    res.status(degraded ? 503 : 200).json({
        status: isShuttingDown() ? 'draining' : (degraded ? 'degraded' : 'ok'),
        service: 'backend',
        uptimeSeconds: Number(process.uptime().toFixed(2)),
        timestamp: new Date().toISOString(),
        correlationId: _req.correlationId || null,
        inFlightRequests: getInFlightRequestCount(),
        dependencies: {
            db: dbHealth,
            redis: redisHealth,
            socket: {
                status: 'ok',
                connectedClients: io.engine.clientsCount,
            },
        },
    });
});

app.get('/', (req, res) => {
    res.send('API is running...');
});

mountServiceBoundaries(app);
app.use('/system', require('./routes/systemRoutes'));
app.use('/api/system', require('./routes/systemRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/admin/auth', require('./routes/adminAuthRoutes'));
app.use('/api/public', require('./routes/publicApiRoutes'));
app.use('/api/v3/public', require('./routes/publicV3Routes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/privacy', require('./routes/privacyRoutes'));
app.use('/api/reputation', require('./routes/reputationRoutes'));
app.use('/api/subscriptions', require('./routes/subscriptionRoutes'));
app.use('/api/bounties', require('./routes/bountyRoutes'));
app.use('/api/employer', require('./routes/employerRoutes'));
app.use('/api/integrations', require('./routes/integrationRoutes'));
app.use('/api/agents', require('./routes/agentMarketplaceRoutes'));
app.use('/api/admin/platform', require('./routes/platformAdminRoutes'));
app.use('/api/financial', require('./routes/financialRoutes'));
app.use('/api/strategic-analytics', require('./routes/strategicAnalyticsRoutes'));
app.use('/api/v1/external', require('./routes/externalV1Routes'));
app.use('/embed', require('./routes/embedRoutes'));
app.use('/sdk', require('./routes/sdkRoutes'));

// ── BLOCK E Feature Add-ons (Saved Jobs, Searches, Follow Company, Explainability, Analytics, Abuse, Transparency)
app.use('/api/features', require('./routes/featureRoutes'));

app.use(notFoundHandler);
app.use(errorHandler);


const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin(origin, callback) {
            if (isAllowedOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error('CORS policy restricted.'), false);
        },
        methods: ['GET', 'POST'],
        credentials: true,
    },
    maxHttpBufferSize: Number.parseInt(process.env.SOCKET_MAX_BUFFER_BYTES || String(1 * 1024 * 1024), 10),
});

app.set('io', io);
setSocketIoServer(io);
const socketAdapterExtraClients = [];
void attachRedisAdapterToSocketIo(io)
    .then((adapterState) => {
        if (adapterState?.enabled) {
            socketAdapterExtraClients.push(adapterState.pubClient, adapterState.subClient);
        } else {
            logger.warn({
                event: 'socket_redis_adapter_disabled',
                reason: adapterState?.reason || 'unknown',
            });
        }
    })
    .catch((error) => {
        logger.warn({
            event: 'socket_redis_adapter_init_failed',
            message: error.message,
        });
    });

const CHAT_ENABLED_STATUSES = new Set([
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'hired',
    // Legacy compatibility.
    'accepted',
    'offer_proposed',
    'interview',
]);
const MAX_JOINED_ROOMS_PER_SOCKET = Number.parseInt(process.env.SOCKET_MAX_JOINED_ROOMS || '20', 10);
const SOCKET_RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.SOCKET_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);
const SOCKET_RATE_LIMITS = {
    join: Number.parseInt(process.env.SOCKET_JOIN_RATE_LIMIT || '30', 10),
    message: Number.parseInt(process.env.SOCKET_MESSAGE_RATE_LIMIT || '60', 10),
    typing: Number.parseInt(process.env.SOCKET_TYPING_RATE_LIMIT || '40', 10),
    read: Number.parseInt(process.env.SOCKET_READ_RATE_LIMIT || '40', 10),
    call: Number.parseInt(process.env.SOCKET_CALL_RATE_LIMIT || '20', 10),
};
const DUPLICATE_MESSAGE_WINDOW_MS = Number.parseInt(process.env.SOCKET_DUPLICATE_MESSAGE_WINDOW_MS || String(2 * 60 * 1000), 10);
const CALL_TIMEOUT_MS = Number.parseInt(process.env.CALL_TIMEOUT_MS || String(45 * 1000), 10);
const callTimeoutHandles = new Map();

const toChatRoomName = (applicationId) => `chat_${String(applicationId || '')}`;
const normalizeApplicationId = (payload = {}) => String(payload.applicationId || payload.roomId || '').trim();
const isValidObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || ''));
const toSocketRoomKey = (socketId) => `socket:rooms:${String(socketId || '')}`;
const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const tokenIssuedBeforePasswordChange = (decoded = {}, user = {}) => {
    const issuedAtMs = Number(decoded?.iat || 0) * 1000;
    const changedAtMs = user?.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
    if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
    if (!Number.isFinite(changedAtMs) || changedAtMs <= 0) return false;
    return issuedAtMs < (changedAtMs - 1000);
};
const sanitizeAttachmentUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return parsed.toString();
    } catch (_error) {
        return '';
    }
};

const consumeSocketAllowance = async (socket, key, limit, windowMs = SOCKET_RATE_LIMIT_WINDOW_MS) => {
    const scopeKey = `${String(socket.data.userId || 'anonymous')}:${String(socket.id)}`;
    return consumeSocketRateLimit({
        namespace: key,
        key: scopeKey,
        limit,
        windowMs,
    });
};

const rememberClientMessageId = async (socket, clientMessageId) => {
    const messageId = String(clientMessageId || '').trim();
    if (!messageId) return false;
    return rememberSocketMessageId({
        namespace: 'chat',
        key: `${socket.data.userId}:${messageId}`,
        dedupeWindowMs: DUPLICATE_MESSAGE_WINDOW_MS,
    });
};

const resolveChatAuthorization = async (socket, applicationId, { requireChatEnabled = true } = {}) => {
    if (!isValidObjectId(applicationId)) {
        return { ok: false, error: 'Invalid application id' };
    }

    const application = await Application.findById(applicationId)
        .populate('worker', 'user')
        .select('worker employer status');

    if (!application) {
        return { ok: false, error: 'Application not found' };
    }

    const userId = String(socket.data.userId || '');
    const employerId = String(application.employer || '');
    const workerUserId = application.worker?.user ? String(application.worker.user) : '';
    const isParticipant = userId && (userId === employerId || userId === workerUserId);

    if (!isParticipant) {
        return { ok: false, error: 'Not authorized for this chat' };
    }

    const status = String(application.status || '').toLowerCase();
    if (requireChatEnabled && !CHAT_ENABLED_STATUSES.has(status)) {
        return { ok: false, error: 'Chat is available after acceptance' };
    }

    return {
        ok: true,
        application,
        peerUserId: userId === employerId ? workerUserId : employerId,
    };
};

const joinAuthorizedRoom = async (socket, applicationId) => {
    const roomName = toChatRoomName(applicationId);
    const alreadyJoined = socket.rooms.has(roomName);
    const joinedCount = Array.from(socket.rooms).filter((room) => room.startsWith('chat_')).length;
    if (!alreadyJoined && joinedCount >= MAX_JOINED_ROOMS_PER_SOCKET) {
        return { ok: false, error: 'Too many joined rooms' };
    }

    await socket.join(roomName);

    try {
        await redisClient.sAdd(toSocketRoomKey(socket.id), applicationId);
        await redisClient.expire(toSocketRoomKey(socket.id), 3600);
    } catch (_error) {
        // Room presence persistence is best-effort.
    }

    return { ok: true, roomName };
};

const clearCallTimeoutForApplication = (applicationId) => {
    const key = String(applicationId || '');
    const existing = callTimeoutHandles.get(key);
    if (existing) {
        clearTimeout(existing);
        callTimeoutHandles.delete(key);
    }
};

const scheduleCallTimeoutForApplication = ({ applicationId, roomName }) => {
    const key = String(applicationId || '');
    clearCallTimeoutForApplication(key);

    const timeoutHandle = setTimeout(async () => {
        try {
            const updated = await CallSession.findOneAndUpdate(
                {
                    applicationId,
                    status: 'ringing',
                },
                {
                    $set: {
                        status: 'timeout',
                        endedAt: new Date(),
                    },
                },
                { new: true }
            ).lean();

            if (updated) {
                io.to(roomName).emit('call_timeout', {
                    applicationId: key,
                    roomId: key,
                    sessionId: String(updated._id),
                    at: new Date().toISOString(),
                });
            }
        } catch (error) {
            logger.warn(`Call timeout handler error: ${error.message}`);
        } finally {
            callTimeoutHandles.delete(key);
        }
    }, CALL_TIMEOUT_MS);

    callTimeoutHandles.set(key, timeoutHandle);
};

io.use(async (socket, next) => {
    try {
        const handshakeToken = String(socket.handshake?.auth?.token || '').trim();
        const headerAuth = String(socket.handshake?.headers?.authorization || '').trim();
        const bearerToken = headerAuth.toLowerCase().startsWith('bearer ')
            ? headerAuth.slice(7).trim()
            : '';
        const token = handshakeToken || bearerToken;

        if (!token) {
            return next(new Error('AUTH_REQUIRED'));
        }

        const decoded = await verifyAccessToken(token);
        const user = await User.findById(decoded.id).select('_id role isDeleted isBanned tokenVersion passwordChangedAt');
        if (!user || user.isDeleted || user.isBanned) {
            return next(new Error('AUTH_REQUIRED'));
        }
        if (resolveTokenVersion(decoded?.tv) !== resolveTokenVersion(user?.tokenVersion)) {
            return next(new Error('AUTH_REQUIRED'));
        }
        if (tokenIssuedBeforePasswordChange(decoded, user)) {
            return next(new Error('AUTH_REQUIRED'));
        }

        socket.data.userId = String(user._id);
        socket.data.userRole = String(user.role || '');
        return next();
    } catch (error) {
        return next(new Error('AUTH_REQUIRED'));
    }
});

io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);
    void markSocketConnected({ socketId: socket.id, userId: socket.data.userId });
    void registerSocketSession({ socketId: socket.id, userId: socket.data.userId });
    const userRoom = `user_${String(socket.data.userId || '')}`;
    if (String(socket.data.userId || '').trim()) {
        void socket.join(userRoom);
    }

    const handleJoinChat = async (payload = {}) => {
        if (!(await consumeSocketAllowance(socket, 'join', SOCKET_RATE_LIMITS.join))) {
            socket.emit('messageFailed', { error: 'Rate limit exceeded for room joins' });
            return;
        }

        const applicationId = normalizeApplicationId(payload);
        const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
        if (!auth.ok) {
            socket.emit('messageFailed', { error: auth.error });
            return;
        }

        const joinResult = await joinAuthorizedRoom(socket, applicationId);
        if (!joinResult.ok) {
            socket.emit('messageFailed', { error: joinResult.error });
            return;
        }

        socket.emit('joined_room', { applicationId });
    };

    socket.on('joinRoom', (payload) => {
        void handleJoinChat(payload);
    });

    socket.on('join_chat', (payload) => {
        void handleJoinChat(payload);
    });

    socket.on('sendMessage', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'message', SOCKET_RATE_LIMITS.message))) {
                socket.emit('messageFailed', { error: 'Message rate limit exceeded' });
                return;
            }

            const applicationId = normalizeApplicationId(payload);
            const trimmedText = sanitizeText(payload.text || '', { maxLength: 5000 });
            const messageType = String(payload.type || 'text').toLowerCase();
            const fileUrl = sanitizeAttachmentUrl(payload.fileUrl);
            const fileName = sanitizeText(payload.fileName || 'Attachment', { maxLength: 120 }) || 'Attachment';
            const messageText = trimmedText || (messageType === 'file' && fileUrl
                ? `[Attachment] ${fileName} ${fileUrl}`
                : '');
            if (!applicationId || !messageText) {
                socket.emit('messageFailed', { error: 'Missing required message fields' });
                return;
            }

            const isDuplicate = await rememberClientMessageId(socket, payload.clientMessageId);
            if (isDuplicate) {
                return;
            }

            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) {
                socket.emit('messageFailed', { error: auth.error });
                return;
            }

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) {
                socket.emit('messageFailed', { error: joinResult.error });
                return;
            }

            const senderId = socket.data.userId;
            const newMessage = await Message.create({
                applicationId,
                sender: senderId,
                type: messageType === 'file' ? 'file' : 'text',
                text: messageText,
                attachmentUrl: messageType === 'file' ? fileUrl : '',
                mimeType: messageType === 'file' ? String(payload.mimeType || '').toLowerCase() : '',
                sizeBytes: messageType === 'file' && Number.isFinite(Number(payload.fileSize))
                    ? Number(payload.fileSize)
                    : null,
                dedupeKey: String(payload.clientMessageId || '').trim() || null,
            });

            await Application.updateOne(
                { _id: applicationId },
                {
                    $set: {
                        conversationLastActiveAt: new Date(),
                        lastActivityAt: new Date(),
                    },
                }
            );

            const populatedMessage = await newMessage.populate('sender', 'name firstName');
            safeLogPlatformEvent({
                type: 'message_sent',
                userId: senderId,
                meta: {
                    messageId: String(newMessage._id),
                    applicationId: String(applicationId),
                    via: 'socket',
                },
            });
            setImmediate(() => {
                enqueueBackgroundJob({
                    type: 'trust_recalculation',
                    payload: {
                        userId: String(senderId),
                        reason: 'message_sent_socket',
                    },
                }).catch(() => { });
            });

            setImmediate(async () => {
                try {
                    await trackFunnelStage({
                        userId: senderId,
                        stage: 'chat',
                        source: 'socket_send_message',
                        metadata: {
                            applicationId: String(applicationId),
                        },
                    });
                    await recordFeatureUsage({
                        userId: senderId,
                        featureKey: 'chat_message_sent',
                        metadata: {
                            applicationId: String(applicationId),
                        },
                    });
                } catch (metricError) {
                    logger.warn(`Socket chat growth tracking failed: ${metricError.message}`);
                }
            });

            io.to(joinResult.roomName).emit('new_message', populatedMessage);
            io.to(joinResult.roomName).emit('receiveMessage', populatedMessage);

            if (auth.peerUserId && auth.peerUserId !== senderId) {
                await dispatchAsyncTask({
                    type: TASK_TYPES.NOTIFICATION_DISPATCH,
                    payload: {
                        userId: String(auth.peerUserId),
                        title: 'New Message',
                        body: messageText,
                        data: { type: 'message', applicationId: String(applicationId) },
                        eventType: 'application_status',
                    },
                    label: 'chat_new_message_push',
                });
            }
        } catch (error) {
            logger.warn(`Socket message error: ${error.message}`);
            socket.emit('messageFailed', { error: 'Failed to send message' });
        }
    });

    socket.on('typing', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'typing', SOCKET_RATE_LIMITS.typing))) {
                return;
            }

            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            socket.to(joinResult.roomName).emit('user_typing', {
                userId: socket.data.userId,
                applicationId,
                roomId: applicationId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`Socket typing error: ${error.message}`);
        }
    });

    socket.on('stop_typing', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'typing', SOCKET_RATE_LIMITS.typing))) {
                return;
            }

            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            socket.to(joinResult.roomName).emit('user_stop_typing', {
                userId: socket.data.userId,
                applicationId,
                roomId: applicationId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`Socket stop_typing error: ${error.message}`);
        }
    });

    socket.on('messages_read', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'read', SOCKET_RATE_LIMITS.read))) {
                return;
            }

            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            await Message.updateMany(
                {
                    applicationId,
                    sender: { $ne: socket.data.userId },
                    readBy: { $ne: socket.data.userId },
                },
                {
                    $addToSet: { readBy: socket.data.userId },
                }
            );

            io.to(joinResult.roomName).emit('messages_read_ack', {
                userId: socket.data.userId,
                applicationId,
                roomId: applicationId,
                readAt: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`Socket messages_read error: ${error.message}`);
        }
    });

    socket.on('call_initiate', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const videoCallsEnabled = await getFeatureFlag('VIDEO_CALLS', true);
            if (!videoCallsEnabled) {
                socket.emit('call_error', { message: 'Video calls are currently disabled' });
                return;
            }
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            const timeoutAt = new Date(Date.now() + CALL_TIMEOUT_MS);
            const session = await CallSession.findOneAndUpdate(
                {
                    applicationId,
                    status: { $in: ['ringing', 'active'] },
                },
                {
                    $set: {
                        roomId: applicationId,
                        callerId: socket.data.userId,
                        calleeId: auth.peerUserId,
                        status: 'ringing',
                        timeoutAt,
                        endedAt: null,
                    },
                    $setOnInsert: {
                        startedAt: null,
                        offer: null,
                        answer: null,
                        iceCandidates: [],
                    },
                },
                {
                    new: true,
                    upsert: true,
                }
            );

            scheduleCallTimeoutForApplication({
                applicationId,
                roomName: joinResult.roomName,
            });

            io.to(joinResult.roomName).emit('call_incoming', {
                roomId: applicationId,
                applicationId,
                sessionId: String(session._id),
                callerId: socket.data.userId,
                at: new Date().toISOString(),
            });
            safeLogPlatformEvent({
                type: 'call_started',
                userId: socket.data.userId,
                meta: {
                    applicationId: String(applicationId),
                    sessionId: String(session._id),
                },
            });
        } catch (error) {
            logger.warn(`call_initiate error: ${error.message}`);
        }
    });

    socket.on('call_offer', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            const timeoutAt = new Date(Date.now() + CALL_TIMEOUT_MS);
            const session = await CallSession.findOneAndUpdate(
                {
                    applicationId,
                    status: { $in: ['ringing', 'active'] },
                },
                {
                    $set: {
                        roomId: applicationId,
                        callerId: socket.data.userId,
                        calleeId: auth.peerUserId,
                        status: 'ringing',
                        offer: payload.offer || null,
                        timeoutAt,
                        endedAt: null,
                    },
                    $setOnInsert: {
                        startedAt: null,
                        answer: null,
                        iceCandidates: [],
                    },
                },
                {
                    new: true,
                    upsert: true,
                }
            );

            scheduleCallTimeoutForApplication({
                applicationId,
                roomName: joinResult.roomName,
            });

            socket.to(joinResult.roomName).emit('call_offer', {
                roomId: applicationId,
                applicationId,
                sessionId: String(session._id),
                offer: payload.offer || null,
                fromUserId: socket.data.userId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`call_offer error: ${error.message}`);
        }
    });

    socket.on('call_answer', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            clearCallTimeoutForApplication(applicationId);
            const session = await CallSession.findOneAndUpdate(
                { applicationId },
                {
                    $set: {
                        answer: payload.answer || null,
                        status: 'active',
                        startedAt: new Date(),
                    },
                },
                {
                    new: true,
                    upsert: true,
                }
            );

            socket.to(joinResult.roomName).emit('call_answer', {
                roomId: applicationId,
                applicationId,
                sessionId: String(session._id),
                answer: payload.answer || null,
                fromUserId: socket.data.userId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`call_answer error: ${error.message}`);
        }
    });

    socket.on('call_ice_candidate', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            if (payload.candidate) {
                await CallSession.updateOne(
                    { applicationId },
                    {
                        $push: {
                            iceCandidates: {
                                $each: [payload.candidate],
                                $slice: -100,
                            },
                        },
                    }
                );
            }

            socket.to(joinResult.roomName).emit('call_ice_candidate', {
                roomId: applicationId,
                applicationId,
                candidate: payload.candidate || null,
                fromUserId: socket.data.userId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`call_ice_candidate error: ${error.message}`);
        }
    });

    socket.on('call_reject', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            clearCallTimeoutForApplication(applicationId);
            const session = await CallSession.findOneAndUpdate(
                { applicationId },
                {
                    $set: {
                        status: 'rejected',
                        endedAt: new Date(),
                    },
                },
                { new: true }
            );

            io.to(joinResult.roomName).emit('call_rejected', {
                roomId: applicationId,
                applicationId,
                sessionId: session ? String(session._id) : null,
                byUserId: socket.data.userId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`call_reject error: ${error.message}`);
        }
    });

    socket.on('call_end', async (payload = {}) => {
        try {
            if (!(await consumeSocketAllowance(socket, 'call', SOCKET_RATE_LIMITS.call))) return;
            const applicationId = normalizeApplicationId(payload);
            const auth = await resolveChatAuthorization(socket, applicationId, { requireChatEnabled: true });
            if (!auth.ok) return;

            const joinResult = await joinAuthorizedRoom(socket, applicationId);
            if (!joinResult.ok) return;

            clearCallTimeoutForApplication(applicationId);
            const session = await CallSession.findOneAndUpdate(
                { applicationId },
                {
                    $set: {
                        status: 'ended',
                        endedAt: new Date(),
                    },
                },
                { new: true }
            );

            io.to(joinResult.roomName).emit('call_ended', {
                roomId: applicationId,
                applicationId,
                sessionId: session ? String(session._id) : null,
                byUserId: socket.data.userId,
                at: new Date().toISOString(),
            });
        } catch (error) {
            logger.warn(`call_end error: ${error.message}`);
        }
    });

    socket.on('disconnect', () => {
        try {
            void redisClient.del(toSocketRoomKey(socket.id));
            void markSocketDisconnected({ socketId: socket.id, userId: socket.data.userId });
            void unregisterSocketSession({ socketId: socket.id, userId: socket.data.userId });
            socket.removeAllListeners();
        } finally {
            logger.info(`Socket disconnected: ${socket.id}`);
        }
    });
});

registerGracefulShutdown({
    server,
    extraClients: socketAdapterExtraClients,
    onBeforeClose: async () => {
        stopGlobalScaleAutopilot();
        stopRegionReplicationDispatcher();
        stopExternalWorker();
        stopExternalEventBridge();
        io.emit('server_shutdown', {
            reason: 'deployment',
            at: new Date().toISOString(),
        });
    },
});
const shouldStartBackgroundMonitors = !isTestRuntime
    || String(process.env.ENABLE_TEST_BACKGROUND_MONITORS || 'false').toLowerCase() === 'true';
if (shouldStartBackgroundMonitors) {
    startResourceWatchdog({ requestGracefulShutdown: (reason) => requestGracefulShutdown(reason) });
    startSystemHealthMonitoring({ io });
    startRegionReplicationDispatcher();
    startGlobalScaleAutopilot();
}

if (!isTestRuntime) {
    startExternalWorker();
    const eventBridgeEnabled = String(process.env.EXTERNAL_EVENT_BRIDGE_ENABLED || 'true').toLowerCase() !== 'false';
    if (eventBridgeEnabled) {
        startExternalEventBridge();
    }
}

if (require.main === module) {
    const allowNonProdRuntime = String(process.env.ALLOW_NON_PROD_RUNTIME || 'false').toLowerCase() === 'true';
    if (!isProduction && !allowNonProdRuntime) {
        logger.error('NODE_ENV must be production when starting the server directly. Set ALLOW_NON_PROD_RUNTIME=true only for local debugging.');
        process.exit(1);
    }

    server.listen(PORT, () => {
        logger.info(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
}

module.exports = { app, server, io };
