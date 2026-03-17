const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

const REQUIRED_SECRETS = [
    'JWT_SECRET',
    'MONGO_URI',
];

const PRODUCTION_ONLY_SECRETS = [
    'REDIS_URL',
    'CORS_ORIGINS',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'API_PUBLIC_URL',
    'FRONTEND_URL',
    'SMTP_VERIFIED_FROM_DOMAIN',
    'SMTP_DKIM_SELECTOR',
    'SMTP_DKIM_DOMAIN',
    'SMTP_SPF_RECORD',
];

const FORBIDDEN_DEV_FLAGS = [
    'ALLOW_NON_PROD_RUNTIME',
    'DISABLE_RATE_LIMITS',
    'BYPASS_AUTH',
    'MOCK_PAYMENTS',
    'INSECURE_MODE',
    'QA_MODE',
    'DEMO_MODE',
    'DEV_MODE',
];

const isPlaceholder = (value) => /^(change_me|default|secret|replace_me|your_|<.+>)$/i.test(String(value || '').trim());
const isPlaceholderProviderValue = (value) => /(example|placeholder|dummy|sandbox|test)/i.test(String(value || '').trim());

const ensureStrongSecret = (name, value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return `${name} is missing`;
    }
    if (normalized.length < 32) {
        return `${name} must be at least 32 characters`;
    }
    if (isPlaceholder(normalized)) {
        return `${name} cannot be a placeholder`;
    }
    return null;
};

const resolveGeminiApiKey = () => {
    const key = String(process.env.GOOGLE_API_KEY || '').trim();
    if (!key) return '';

    process.env.GEMINI_API_KEY = key;
    return key;
};

const validateRequiredSecrets = ({ isProductionLike }) => {
    const missing = [];
    const weak = [];

    const keys = isProductionLike
        ? [...REQUIRED_SECRETS, ...PRODUCTION_ONLY_SECRETS]
        : REQUIRED_SECRETS;

    if (isProductionLike && !resolveGeminiApiKey()) {
        missing.push('GEMINI_API_KEY_NOT_CONFIGURED');
    }

    keys.forEach((key) => {
        const value = String(process.env[key] || '').trim();
        if (!value) {
            missing.push(key);
            return;
        }

        if (['JWT_SECRET'].includes(key)) {
            const weakReason = ensureStrongSecret(key, value);
            if (weakReason) {
                weak.push(weakReason);
            }
        }
    });

    return { missing, weak };
};

const validateProductionFlags = () => {
    const violations = [];
    FORBIDDEN_DEV_FLAGS.forEach((flag) => {
        const value = String(process.env[flag] || '').trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(value)) {
            violations.push(`${flag} must be disabled in production`);
        }
    });
    return violations;
};

const validateOtpTransportPolicy = ({ isProduction = false } = {}) => {
    const violations = [];
    const smtpHost = String(process.env.SMTP_HOST || '').trim();
    const smtpPort = Number.parseInt(process.env.SMTP_PORT || '', 10);
    const smtpTls = String(process.env.SMTP_REQUIRE_TLS || 'true').trim().toLowerCase() !== 'false';
    const smtpUser = String(process.env.SMTP_EMAIL || process.env.SMTP_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();
    const fromEmail = String(process.env.FROM_EMAIL || process.env.SMTP_FROM || '').trim().toLowerCase();
    const verifiedDomain = String(process.env.SMTP_VERIFIED_FROM_DOMAIN || '').trim().toLowerCase();
    const fromDomain = String(fromEmail.split('@')[1] || '').trim().toLowerCase();

    if (isProduction && /(mailtrap|ethereal|sandbox|example\.com)/i.test(smtpHost)) {
        violations.push('SMTP_HOST must not use sandbox providers in production');
    }
    if (!smtpUser || isPlaceholder(smtpUser) || isPlaceholderProviderValue(smtpUser)) {
        violations.push('SMTP_EMAIL/SMTP_USER must be configured to a non-placeholder value');
    }
    if (!smtpPass || isPlaceholder(smtpPass) || isPlaceholderProviderValue(smtpPass)) {
        violations.push('SMTP_PASSWORD/SMTP_PASS must be configured to a non-placeholder value');
    }
    if (isProduction && ![465, 587].includes(smtpPort)) {
        violations.push('SMTP_PORT must be 465 or 587 in production');
    }
    if (!isProduction && (!Number.isFinite(smtpPort) || smtpPort <= 0)) {
        violations.push('SMTP_PORT must be a valid positive port');
    }
    if (isProduction && !smtpTls) {
        violations.push('SMTP_REQUIRE_TLS must be enabled in production');
    }
    if (!verifiedDomain || !fromDomain || !fromDomain.endsWith(verifiedDomain)) {
        violations.push('FROM_EMAIL must match SMTP_VERIFIED_FROM_DOMAIN');
    }
    if (isPlaceholder(verifiedDomain) || isPlaceholderProviderValue(verifiedDomain)) {
        violations.push('SMTP_VERIFIED_FROM_DOMAIN must be configured to a non-placeholder value');
    }
    if (isPlaceholder(fromEmail) || isPlaceholderProviderValue(fromEmail) || fromDomain === 'example.com') {
        violations.push('FROM_EMAIL must be configured to a non-placeholder verified domain');
    }

    const sid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const fromPhone = String(process.env.TWILIO_FROM_PHONE || '').trim();

    if (!/^AC[a-f0-9]{32}$/i.test(sid) || isPlaceholder(sid) || isPlaceholderProviderValue(sid)) {
        violations.push('TWILIO_ACCOUNT_SID must be a production account SID');
    }
    if (authToken.length < 24 || /(test|sandbox|example)/i.test(authToken) || isPlaceholder(authToken) || isPlaceholderProviderValue(authToken)) {
        violations.push('TWILIO_AUTH_TOKEN appears non-production');
    }
    if (
        !/^\+\d{10,15}$/.test(fromPhone)
        || /^\+?1500555\d{4}$/.test(fromPhone)
        || isPlaceholder(fromPhone)
        || isPlaceholderProviderValue(fromPhone)
    ) {
        violations.push('TWILIO_FROM_PHONE must be a valid non-test sender');
    }

    return violations;
};

const validateRuntimeWritablePaths = () => {
    const violations = [];

    const logsPath = path.resolve(__dirname, '..', '..', 'logs');
    const exportsPath = path.resolve(__dirname, '..', 'exports');

    [logsPath, exportsPath].forEach((target) => {
        try {
            fs.mkdirSync(target, { recursive: true });
            fs.accessSync(target, fs.constants.W_OK);
        } catch (error) {
            violations.push(`Runtime path is not writable: ${target}`);
        }
    });

    return violations;
};

const startupIntegrityCheck = ({ strict = true } = {}) => {
    const runtime = String(process.env.NODE_ENV || 'development').toLowerCase();
    const isProduction = runtime === 'production';
    const isProductionLike = isProduction || runtime === 'staging';
    const isTest = runtime === 'test';

    const findings = [];

    const { missing, weak } = validateRequiredSecrets({ isProductionLike });
    if (missing.length) {
        findings.push(`Missing required env: ${missing.join(', ')}`);
    }
    findings.push(...weak);

    if (isProductionLike) {
        findings.push(...validateProductionFlags());
        const corsOrigins = String(process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
        if (!corsOrigins.length || corsOrigins.includes('*')) {
            findings.push('CORS_ORIGINS must be a strict allowlist in production');
        }
    }

    if (isProductionLike && !isTest) {
        findings.push(...validateOtpTransportPolicy({ isProduction: true }));
    }

    findings.push(...validateRuntimeWritablePaths());

    const passed = findings.length === 0;

    logger.info({
        event: 'startup_integrity_check',
        passed,
        runtime,
        findingsCount: findings.length,
    });

    if (!passed && strict) {
        const error = new Error(`startupIntegrityCheck failed: ${findings.join(' | ')}`);
        error.code = 'STARTUP_INTEGRITY_FAILED';
        throw error;
    }

    return {
        passed,
        runtime,
        findings,
        checkedAt: new Date().toISOString(),
    };
};

module.exports = {
    startupIntegrityCheck,
};
