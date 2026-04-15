const { z } = require('zod');

const runtimeSchema = z.enum(['development', 'test', 'staging', 'production']);

const requiredBaseKeys = [
    'MONGO_URI',
    'JWT_SECRET',
];

const productionRequiredKeys = [
    'REDIS_URL',
    'CORS_ORIGINS',
    'API_PUBLIC_URL',
    'FRONTEND_URL',
    'SMART_INTERVIEW_DATASET_SALT',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_VERIFIED_FROM_DOMAIN',
    'SMTP_DKIM_SELECTOR',
    'SMTP_DKIM_DOMAIN',
    'SMTP_SPF_RECORD',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_PHONE',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
];

const otpTransportRequiredKeys = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_VERIFIED_FROM_DOMAIN',
    'SMTP_DKIM_SELECTOR',
    'SMTP_DKIM_DOMAIN',
    'SMTP_SPF_RECORD',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_PHONE',
];

const looksLocal = (value) => /(localhost|127\.0\.0\.1)/i.test(String(value || ''));

const isPlaceholderSecret = (value) => /^(change_me|default|secret|your_|replace_me)/i.test(String(value || ''));
const isPlaceholderProviderValue = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return true;
    if (/^(change_me|default|secret|replace_me|your_|<.+>)$/i.test(normalized)) return true;
    return /(example|placeholder|dummy|sandbox|test)/i.test(normalized);
};

const getGeminiApiKey = ({ required = true } = {}) => {
    if (required && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
        const error = new Error('GEMINI_API_KEY_NOT_CONFIGURED');
        error.code = 'GEMINI_API_KEY_NOT_CONFIGURED';
        throw error;
    }
    const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const looksPlaceholder = (
        key.startsWith('<')
        || key.endsWith('>')
        || key.toLowerCase().includes('your_real_key')
        || key.toLowerCase().includes('replace')
        || key.length < 24
    );

    if (key) {
        process.env.GEMINI_API_KEY = key;
        process.env.GOOGLE_API_KEY = key;
    }

    if (!required) return key;

    if (!key || looksPlaceholder) {
        const error = new Error('GEMINI_API_KEY_NOT_CONFIGURED');
        error.code = 'GEMINI_API_KEY_NOT_CONFIGURED';
        throw error;
    }

    return key;
};

const assertStrongSecret = (name) => {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    if (value.length < 32) {
        throw new Error(`${name} must be at least 32 characters`);
    }
    if (isPlaceholderSecret(value)) {
        throw new Error(`${name} cannot use placeholder values`);
    }
};

const validateEnvironment = () => {
    const runtimeResult = runtimeSchema.safeParse(String(process.env.NODE_ENV || '').trim().toLowerCase());
    if (!runtimeResult.success) {
        throw new Error('NODE_ENV must be one of development, test, staging, production');
    }

    const runtime = runtimeResult.data;
    const isProduction = runtime === 'production';
    const isStaging = runtime === 'staging';
    const isTest = runtime === 'test';

    // Gemini is optional in local/test, but required for prod-like runtimes.
    getGeminiApiKey({ required: isProduction || isStaging });

    // Keep local runtime minimal: derive optional secrets from JWT_SECRET when absent.
    const jwtSecret = String(process.env.JWT_SECRET || '').trim();
    if (jwtSecret) {
        if (!String(process.env.JWT_REFRESH_SECRET || '').trim()) {
            process.env.JWT_REFRESH_SECRET = jwtSecret;
        }
        if (!String(process.env.OTP_HMAC_SECRET || '').trim()) {
            process.env.OTP_HMAC_SECRET = jwtSecret;
        }
        if (!String(process.env.PLATFORM_ENCRYPTION_SECRET || '').trim()) {
            process.env.PLATFORM_ENCRYPTION_SECRET = `${jwtSecret}${jwtSecret}`.slice(0, Math.max(32, `${jwtSecret}${jwtSecret}`.length));
        }
        if (!String(process.env.SMART_INTERVIEW_DATASET_SALT || '').trim()) {
            process.env.SMART_INTERVIEW_DATASET_SALT = jwtSecret;
        }
    }

    const requiredKeys = isProduction
        ? [...requiredBaseKeys, ...productionRequiredKeys]
        : requiredBaseKeys;

    const missing = requiredKeys.filter((key) => !String(process.env[key] || '').trim());

    if (isProduction) {
        const smtpUser = String(process.env.SMTP_EMAIL || process.env.SMTP_USER || '').trim();
        const smtpPass = String(process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();
        const smtpFrom = String(process.env.FROM_EMAIL || process.env.SMTP_FROM || '').trim();
        if (!smtpUser) missing.push('SMTP_EMAIL or SMTP_USER');
        if (!smtpPass) missing.push('SMTP_PASSWORD or SMTP_PASS');
        if (!smtpFrom) missing.push('FROM_EMAIL or SMTP_FROM');
        if (isPlaceholderProviderValue(smtpUser)) missing.push('SMTP_EMAIL/SMTP_USER (non-placeholder)');
        if (isPlaceholderProviderValue(smtpPass)) missing.push('SMTP_PASSWORD/SMTP_PASS (non-placeholder)');
        if (isPlaceholderProviderValue(smtpFrom)) missing.push('FROM_EMAIL/SMTP_FROM (non-placeholder)');

        const smtpHost = String(process.env.SMTP_HOST || '').trim();
        const verifiedDomain = String(process.env.SMTP_VERIFIED_FROM_DOMAIN || '').trim().toLowerCase();
        const fromDomain = String(smtpFrom.split('@')[1] || '').trim().toLowerCase();
        const tlsEnabled = String(process.env.SMTP_REQUIRE_TLS || 'true').trim().toLowerCase() !== 'false';
        if (isPlaceholderProviderValue(smtpHost)) {
            throw new Error('SMTP_HOST must not use placeholder or test values');
        }
        if (isPlaceholderProviderValue(verifiedDomain)) {
            throw new Error('SMTP_VERIFIED_FROM_DOMAIN must not use placeholder or test values');
        }
        if (/(mailtrap|ethereal|sandbox|example\.com)/i.test(smtpHost)) {
            throw new Error('SMTP_HOST must not use sandbox providers');
        }
        if (!verifiedDomain || !fromDomain || !fromDomain.endsWith(verifiedDomain)) {
            throw new Error('FROM_EMAIL must match SMTP_VERIFIED_FROM_DOMAIN');
        }
        if (!tlsEnabled) {
            throw new Error('SMTP_REQUIRE_TLS must be enabled');
        }

        const twilioSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
        const twilioToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
        const twilioFrom = String(process.env.TWILIO_FROM_PHONE || '').trim();
        if (!/^AC[a-f0-9]{32}$/i.test(twilioSid) || isPlaceholderProviderValue(twilioSid)) {
            throw new Error('TWILIO_ACCOUNT_SID must be a real non-test account SID');
        }
        if (twilioToken.length < 24 || isPlaceholderProviderValue(twilioToken)) {
            throw new Error('TWILIO_AUTH_TOKEN must be a real non-test auth token');
        }
        if (!/^\+\d{10,15}$/.test(twilioFrom) || /^\+?1500555\d{4}$/.test(twilioFrom) || isPlaceholderProviderValue(twilioFrom)) {
            throw new Error('TWILIO_FROM_PHONE must be a valid non-test sender');
        }
    }

    if (missing.length) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (isProduction) {
        assertStrongSecret('JWT_SECRET');
        assertStrongSecret('JWT_REFRESH_SECRET');
        assertStrongSecret('OTP_HMAC_SECRET');
    }

    const mongoUri = String(process.env.MONGO_URI || '').trim();
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    const apiPublicUrl = String(process.env.API_PUBLIC_URL || '').trim();
    const frontendUrl = String(process.env.FRONTEND_URL || '').trim();

    if (isProduction && looksLocal(mongoUri)) {
        throw new Error('MONGO_URI must not point to localhost in production');
    }
    if (isProduction && looksLocal(redisUrl)) {
        throw new Error('REDIS_URL must not point to localhost in production');
    }
    if (isProduction && looksLocal(apiPublicUrl)) {
        throw new Error('API_PUBLIC_URL must not point to localhost in production');
    }
    if (isProduction && looksLocal(frontendUrl)) {
        throw new Error('FRONTEND_URL must not point to localhost in production');
    }

    const corsOriginsRaw = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').trim();
    if (isProduction && !corsOriginsRaw) {
        throw new Error('CORS_ORIGINS must be configured in production');
    }
    if (isProduction) {
        const origins = corsOriginsRaw
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);

        if (!origins.length || origins.includes('*')) {
            throw new Error('CORS_ORIGINS cannot be wildcard in production');
        }
    }

    const accessTtl = String(process.env.JWT_ACCESS_EXPIRES_IN || '15m').trim();
    const refreshTtl = String(process.env.JWT_REFRESH_EXPIRES_IN || '30d').trim();
    if (!accessTtl || !refreshTtl) {
        throw new Error('JWT_ACCESS_EXPIRES_IN and JWT_REFRESH_EXPIRES_IN must be set');
    }

    return {
        runtime,
        isProduction,
        isTest,
        corsOriginsRaw,
    };
};

module.exports = {
    getGeminiApiKey,
    validateEnvironment,
};
