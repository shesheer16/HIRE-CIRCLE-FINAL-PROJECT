console.log('1. Starting index.js...');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// LOAD ENV VARS FIRST
dotenv.config();

const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_BUCKET_NAME', 'GEMINI_API_KEY'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('FATAL: Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// SENTRY INITIALIZATION (Must be early)
Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://examplePublicKey@o0.ingest.sentry.io/0", // Fallback/dummy for dev
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
// LOAD ENV VARS FIRST
dotenv.config();

console.log('2. Modules imported. Config...');
const path = require('path');
const morgan = require('morgan');
const logger = require('./utils/logger');
const connectDB = require('./config/db');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

logger.info('3. DB Module loaded. Loading Routes...');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const jobRoutes = require('./routes/jobRoutes'); // Added based on app.use
const applicationRoutes = require('./routes/applicationRoutes'); // Added based on app.use
const chatRoutes = require('./routes/chatRoutes'); // Added based on app.use
const matchRoutes = require('./routes/matchingRoutes'); // Added based on app.use
const analyticsRoutes = require('./routes/analyticsRoutes'); // NEW: Analytics
const notificationRoutes = require('./routes/notificationRoutes'); // NEW: Notifications
const adminRoutes = require('./routes/adminRoutes'); // NEW: Admin API
const feedbackRoutes = require('./routes/feedbackRoutes'); // NEW: Beta Feedback
const paymentRoutes = require('./routes/paymentRoutes'); // NEW: Stripe Payments
const insightRoutes = require('./routes/insightRoutes'); // NEW: AI Insights
const growthRoutes = require('./routes/growthRoutes'); // NEW: Viral loops
const orgRoutes = require('./routes/orgRoutes'); // NEW: Enterprise Features
const publicApiRoutes = require('./routes/publicApiRoutes'); // NEW: Developer API
const feedRoutes = require('./routes/feedRoutes');
const pulseRoutes = require('./routes/pulseRoutes');
const academyRoutes = require('./routes/academyRoutes');
const circlesRoutes = require('./routes/circlesRoutes');

console.log('4. Connecting to DB...');
logger.info('4. Connecting to DB...');
connectDB();

const app = express();
logger.info('5. Express initialized.');

// SENTRY: The request handler must be the first middleware on the app
// Sentry v8+ handles this differently, commenting out to avoid crash
// app.use(Sentry.Handlers.requestHandler());
// app.use(Sentry.Handlers.tracingHandler());

// Security Headers
app.use(helmet());

// API Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', apiLimiter);

// Strict CORS
const envOrigins = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([
  'http://localhost:19006',
  'http://localhost:8081',
  'http://localhost:3000',
  ...envOrigins
]));
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow mobile/curl
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy restricted.'), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

// STRIPE WEBHOOK MUST BE BEFORE express.json()
app.use('/api/payment', paymentRoutes);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request Logging Middleware (Morgan + Winston)
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Serve the uploads folder so users can watch their videos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Swagger API Docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background-color: #9333ea; }',
  customSiteTitle: 'HireCircle API Docs',
}));

// Uptime Monitoring / Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: Date.now() });
});
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/', (req, res) => {
  res.send('API is running...');
});

// Use the routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes); // Register Upload Routes
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/analytics', analyticsRoutes); // Attach analytics routes
app.use('/api/notifications', notificationRoutes); // Attach notification routes
app.use('/api/admin', adminRoutes); // Attach admin routes
app.use('/api/feedback', feedbackRoutes); // Attach feedback routes
app.use('/api/insights', insightRoutes); // Attach AI insights
app.use('/api/growth', growthRoutes); // Attach Viral loops
app.use('/api/organizations', orgRoutes); // Attach Enterprise orgs
app.use('/api/public', publicApiRoutes); // Attach Developer Partner API
app.use('/api/feed', feedRoutes);
app.use('/api/pulse', pulseRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/circles', circlesRoutes);

// SENTRY: The error handler must be before any other error middleware and after all controllers
// app.use(Sentry.Handlers.errorHandler());

const PORT = process.env.PORT || 3000;

// --- SOCKET.IO SETUP ---
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all for dev
    methods: ["GET", "POST"]
  }
});

// Pass io to routes if needed (or use export)
app.set('io', io);

io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  socket.on('joinRoom', ({ applicationId }) => {
    if (!applicationId) return;
    socket.join(applicationId);
    console.log(`User ${socket.id} joined room: ${applicationId}`);
  });

  socket.on('sendMessage', async (data = {}) => {
    // data = { applicationId, senderId, receiverId, text }
    try {
      const { applicationId, senderId, text } = data;
      const trimmedText = String(text || '').trim();

      if (!applicationId || !senderId || !trimmedText) {
        socket.emit('messageFailed', { error: 'Missing required message fields' });
        return;
      }

      const Application = require('./models/Application');
      const application = await Application.findById(applicationId)
        .populate('worker', 'user')
        .select('worker employer status');

      if (!application) {
        socket.emit('messageFailed', { error: 'Application not found' });
        return;
      }

      const senderIdStr = String(senderId);
      const employerIdStr = String(application.employer);
      const workerUserId = application.worker?.user ? String(application.worker.user) : null;

      const isParticipant = senderIdStr === employerIdStr || senderIdStr === workerUserId;
      if (!isParticipant) {
        socket.emit('messageFailed', { error: 'Not authorized for this chat' });
        return;
      }

      if (String(application.status || '').toLowerCase() !== 'accepted') {
        socket.emit('messageFailed', { error: 'Chat is available after acceptance' });
        return;
      }

      // Save to DB
      const Message = require('./models/Message');
      const newMessage = await Message.create({
        applicationId: applicationId, // Match schema (was application)
        sender: senderId,
        // receiver: receiverId, // Schema doesn't have receiver, it's inferred from Application
        text: trimmedText
      });

      // Populate sender for frontend display
      const populatedMessage = await newMessage.populate('sender', 'name firstName');

      // Emit to Room
      io.to(applicationId).emit('receiveMessage', populatedMessage);

      // Push notification to the other party in this application chat
      try {
        const User = require('./models/userModel');
        const { sendPushNotification } = require('./services/pushService');

        let receiverUserId = null;
        if (senderIdStr === employerIdStr) {
          receiverUserId = workerUserId;
        } else {
          receiverUserId = employerIdStr;
        }

        if (receiverUserId && receiverUserId !== senderIdStr) {
          const receiver = await User.findById(receiverUserId).select('pushTokens');
          await sendPushNotification(
            receiver?.pushTokens || [],
            'New Message',
            trimmedText || 'You have a new message',
            { type: 'message', applicationId: String(applicationId) }
          );
        }
      } catch (pushError) {
        console.error('Chat push error:', pushError.message);
      }

    } catch (err) {
      console.error("Socket Message Error:", err);
      socket.emit('messageFailed', { error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('User Disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  logger.info(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
