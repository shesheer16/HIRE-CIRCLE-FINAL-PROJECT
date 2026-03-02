const winston = require('winston');
const { getCorrelationId } = require('./requestContext');

const logLevels = {
    error: 0,
    warn: 1,
    security: 2,
    info: 3,
    debug: 4,
};

const piiKeyPattern = /(email|phone|name|firstName|lastName|address|aadhaar|pan|dob)/i;
const secretKeyPattern = /(password|otp|token|secret|authorization|cookie|apiKey|accessKey|refresh|jwt)/i;

const maskEmail = (value) => {
    const normalized = String(value || '');
    const [local = '', domain = ''] = normalized.split('@');
    if (!domain) return '[REDACTED]';
    if (local.length <= 2) return `**@${domain}`;
    return `${local.slice(0, 2)}***@${domain}`;
};

const maskPhone = (value) => {
    const normalized = String(value || '').replace(/\D/g, '');
    if (normalized.length <= 4) return '[REDACTED]';
    return `***${normalized.slice(-4)}`;
};

const sanitizeString = (value) => {
    let output = String(value || '');
    output = output.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
    output = output.replace(/\b\d{4,8}\b/g, (match) => (match.length >= 6 ? '[REDACTED_OTP]' : match));
    return output;
};

const sanitizeValue = (value, key = '', depth = 0) => {
    if (depth > 5) return '[TRUNCATED]';

    if (value === null || typeof value === 'undefined') return value;

    if (secretKeyPattern.test(key)) {
        return '[REDACTED]';
    }

    if (typeof value === 'string') {
        if (piiKeyPattern.test(key) && value.includes('@')) {
            return maskEmail(value);
        }
        if (piiKeyPattern.test(key) && /\d{8,}/.test(value)) {
            return maskPhone(value);
        }
        return sanitizeString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') return value;

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, key, depth + 1));
    }

    if (typeof value === 'object') {
        const output = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            output[childKey] = sanitizeValue(childValue, childKey, depth + 1);
        }
        return output;
    }

    return '[UNSERIALIZABLE]';
};

const injectContext = winston.format((info) => {
    const correlationId = getCorrelationId();
    if (correlationId && !info.correlationId) {
        info.correlationId = correlationId;
    }
    return info;
});

const sanitizeInfo = winston.format((info) => {
    const sanitized = sanitizeValue(info);
    return sanitized;
});

const baseFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    injectContext(),
    sanitizeInfo(),
    winston.format.json()
);

const logger = winston.createLogger({
    levels: logLevels,
    level: String(process.env.LOG_LEVEL || 'info').toLowerCase(),
    transports: [
        new winston.transports.File({
            filename: './logs/app.log',
            handleExceptions: false,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 10,
            format: baseFormat,
        }),
        new winston.transports.Console({
            handleExceptions: false,
            format: baseFormat,
        }),
    ],
    exitOnError: false,
});

logger.stream = {
    write(message) {
        logger.info({ event: 'http_access', message: String(message || '').trim() });
    },
};

module.exports = logger;
