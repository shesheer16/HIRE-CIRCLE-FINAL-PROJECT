const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { resolveRegionConfig } = require('./region');

const SLOW_QUERY_MS = Number.parseInt(process.env.DB_SLOW_QUERY_MS || '200', 10);
let instrumentationInstalled = false;
let readReplicaConnection = null;

const parseFailoverMongoUris = () => {
  const fromCsv = String(process.env.MONGO_URI_FAILOVER || '')
    .split(',')
    .map((uri) => String(uri || '').trim())
    .filter(Boolean);

  const fromJson = (() => {
    const raw = String(process.env.MONGO_URI_FAILOVER_JSON || '').trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      return Object.values(parsed).map((uri) => String(uri || '').trim()).filter(Boolean);
    } catch (_error) {
      return [];
    }
  })();

  return Array.from(new Set([...fromCsv, ...fromJson]));
};

const trackMongoCommands = (mongooseConnection) => {
  if (instrumentationInstalled) return;

  const client = mongooseConnection?.getClient?.();
  if (!client || typeof client.on !== 'function') return;

  instrumentationInstalled = true;
  const commandStartTimes = new Map();

  client.on('commandStarted', (event) => {
    commandStartTimes.set(event.requestId, Date.now());

    if (commandStartTimes.size > 50000) {
      commandStartTimes.clear();
      logger.warn({ event: 'mongo_command_tracker_reset', reason: 'size_limit' });
    }
  });

  client.on('commandSucceeded', (event) => {
    const startedAt = commandStartTimes.get(event.requestId);
    commandStartTimes.delete(event.requestId);
    if (!startedAt) return;

    const durationMs = Date.now() - startedAt;
    if (durationMs >= SLOW_QUERY_MS) {
      logger.warn({
        event: 'slow_query',
        commandName: event.commandName,
        durationMs,
        databaseName: event.databaseName,
      });
    }
  });

  client.on('commandFailed', (event) => {
    const startedAt = commandStartTimes.get(event.requestId);
    commandStartTimes.delete(event.requestId);

    const durationMs = startedAt ? (Date.now() - startedAt) : null;
    logger.warn({
      event: 'mongo_command_failed',
      commandName: event.commandName,
      durationMs,
      databaseName: event.databaseName,
      message: event?.failure?.errmsg || 'command failed',
    });
  });
};

const connectDB = async () => {
  const regionConfig = resolveRegionConfig();
  const primaryMongoUri = String(process.env.MONGO_URI || regionConfig.dbWriteUri || '').trim();
  const failoverMongoUris = parseFailoverMongoUris();
  const candidateUris = Array.from(new Set([primaryMongoUri, ...failoverMongoUris].filter(Boolean)));
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!candidateUris.length) {
    throw new Error('MONGO_URI must be configured');
  }

  mongoose.set('strictQuery', true);

  let conn = null;
  let lastError = null;

  for (const mongoUri of candidateUris) {
    if (isProduction && /(localhost|127\.0\.0\.1)/i.test(mongoUri)) {
      lastError = new Error('MONGO_URI cannot target localhost in production');
      continue;
    }

    try {
      conn = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: Number.parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10),
        maxPoolSize: Number.parseInt(process.env.MONGO_MAX_POOL_SIZE || '40', 10),
        minPoolSize: Number.parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),
        maxIdleTimeMS: Number.parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || '60000', 10),
        waitQueueTimeoutMS: Number.parseInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || '15000', 10),
        autoIndex: String(process.env.MONGO_AUTO_INDEX || 'false').toLowerCase() === 'true',
        monitorCommands: true,
      });
      logger.info(`MongoDB Connected: ${conn.connection.host} (region: ${regionConfig.region})`);
      trackMongoCommands(conn.connection);
      break;
    } catch (error) {
      lastError = error;
      logger.warn(`MongoDB connection failed for candidate URI, trying failover if available: ${error.message}`);
    }
  }

  if (!conn) {
    throw lastError || new Error('MongoDB connection failed');
  }

  const readReplicaUri = String(process.env.MONGO_READ_URI || regionConfig.dbReadReplicaUri || '').trim();
  if (readReplicaUri) {
    try {
      readReplicaConnection = await mongoose.createConnection(readReplicaUri, {
        serverSelectionTimeoutMS: Number.parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10),
        maxPoolSize: Number.parseInt(process.env.MONGO_READ_MAX_POOL_SIZE || process.env.MONGO_MAX_POOL_SIZE || '40', 10),
        minPoolSize: Number.parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),
        maxIdleTimeMS: Number.parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || '60000', 10),
        waitQueueTimeoutMS: Number.parseInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || '15000', 10),
        monitorCommands: true,
        readPreference: 'secondaryPreferred',
      }).asPromise();
      logger.info(`MongoDB Read Replica Connected: ${readReplicaConnection.host}`);
    } catch (readError) {
      readReplicaConnection = null;
      logger.warn(`MongoDB read replica connection failed, using primary only: ${readError.message}`);
    }
  }

  return conn;
};

module.exports = connectDB;
module.exports.getReadConnection = () => readReplicaConnection || mongoose.connection;
module.exports.getWriteConnection = () => mongoose.connection;
