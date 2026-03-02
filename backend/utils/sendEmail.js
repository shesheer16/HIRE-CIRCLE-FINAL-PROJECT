const nodemailer = require('nodemailer');
const logger = require('./logger');

const isProductionRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const isTestRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'test';
const SANDBOX_SMTP_HOST_PATTERN = /(mailtrap|ethereal|sandbox|example\.com)/i;
const PLACEHOLDER_VALUE_PATTERN = /^(change_me|default|secret|replace_me|your_|<.+>)$/i;
const PLACEHOLDER_SMTP_VALUE_PATTERN = /(example\.com|example\.org|test|dummy|placeholder)/i;

const resolveSmtpValue = (...keys) => {
    for (const key of keys) {
        const value = String(process.env[key] || '').trim();
        if (value) return value;
    }
    return '';
};

const isPlaceholderLike = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return true;
    if (PLACEHOLDER_VALUE_PATTERN.test(normalized)) return true;
    return PLACEHOLDER_SMTP_VALUE_PATTERN.test(normalized);
};

const getRequiredEmailConfig = () => {
    const host = resolveSmtpValue('SMTP_HOST');
    const port = Number.parseInt(process.env.SMTP_PORT || '', 10);
    const user = resolveSmtpValue('SMTP_EMAIL', 'SMTP_USER');
    const pass = resolveSmtpValue('SMTP_PASSWORD', 'SMTP_PASS');
    const fromEmail = resolveSmtpValue('FROM_EMAIL', 'SMTP_FROM');
    const fromName = String(process.env.FROM_NAME || 'HireCircle').trim();

    const missing = [];
    if (!host) missing.push('SMTP_HOST');
    if (!Number.isFinite(port) || port <= 0) missing.push('SMTP_PORT');
    if (!user) missing.push('SMTP_EMAIL/SMTP_USER');
    if (!pass) missing.push('SMTP_PASSWORD/SMTP_PASS');
    if (!fromEmail) missing.push('FROM_EMAIL/SMTP_FROM');

    if (missing.length) {
        throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`);
    }

    const verifiedDomain = String(process.env.SMTP_VERIFIED_FROM_DOMAIN || '').trim().toLowerCase();
    const fromDomain = String(fromEmail.split('@')[1] || '').trim().toLowerCase();
    const tlsRequired = String(process.env.SMTP_REQUIRE_TLS || 'true').trim().toLowerCase() !== 'false';
    const isNonTestRuntime = !isTestRuntime();

    if (isNonTestRuntime) {
        if (isPlaceholderLike(host)) {
            const error = new Error('SMTP_HOST cannot be a placeholder value');
            error.code = 'EMAIL_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(user)) {
            const error = new Error('SMTP_EMAIL/SMTP_USER cannot be a placeholder value');
            error.code = 'EMAIL_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(pass)) {
            const error = new Error('SMTP_PASSWORD/SMTP_PASS cannot be a placeholder value');
            error.code = 'EMAIL_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(fromEmail) || fromDomain === 'example.com') {
            const error = new Error('FROM_EMAIL must be a verified non-placeholder email');
            error.code = 'EMAIL_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(verifiedDomain) || verifiedDomain === 'example.com') {
            const error = new Error('SMTP_VERIFIED_FROM_DOMAIN must be configured to a verified domain');
            error.code = 'EMAIL_PROVIDER_CONFIG_INVALID';
            throw error;
        }
    }

    if (isProductionRuntime()) {
        if (SANDBOX_SMTP_HOST_PATTERN.test(host)) {
            throw new Error('SMTP host cannot be a sandbox provider in production');
        }
        if (!verifiedDomain) {
            throw new Error('SMTP_VERIFIED_FROM_DOMAIN is required in production');
        }
        if (!fromDomain || !fromDomain.endsWith(verifiedDomain)) {
            throw new Error('FROM_EMAIL must use a verified production domain');
        }
        if (!tlsRequired) {
            throw new Error('SMTP TLS must be enforced in production');
        }
    }

    return {
        host,
        port,
        auth: { user, pass },
        secure: port === 465,
        requireTLS: tlsRequired,
        tls: {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
        },
        from: `${fromName} <${fromEmail}>`,
    };
};

const hasSmtpConfig = () => {
    const host = resolveSmtpValue('SMTP_HOST');
    const port = Number.parseInt(process.env.SMTP_PORT || '', 10);
    const user = resolveSmtpValue('SMTP_EMAIL', 'SMTP_USER');
    const pass = resolveSmtpValue('SMTP_PASSWORD', 'SMTP_PASS');
    const fromEmail = resolveSmtpValue('FROM_EMAIL', 'SMTP_FROM');
    const verifiedDomain = String(process.env.SMTP_VERIFIED_FROM_DOMAIN || '').trim().toLowerCase();
    const fromDomain = String(fromEmail.split('@')[1] || '').trim().toLowerCase();

    return Boolean(
        host
        && Number.isFinite(port)
        && port > 0
        && user
        && pass
        && fromEmail
        && !isPlaceholderLike(host)
        && !isPlaceholderLike(user)
        && !isPlaceholderLike(pass)
        && !isPlaceholderLike(fromEmail)
        && !isPlaceholderLike(verifiedDomain)
        && fromDomain !== 'example.com'
        && verifiedDomain !== 'example.com'
    );
};

const sendEmail = async (options = {}) => {
    const to = String(options.email || '').trim();
    const subject = String(options.subject || '').trim();
    const text = String(options.message || '').trim();

    if (!to || !subject || !text) {
        throw new Error('sendEmail requires email, subject, and message');
    }

    const smtp = getRequiredEmailConfig();

    if (isTestRuntime() && String(process.env.SMTP_SKIP_SEND || '').toLowerCase() === 'true') {
        logger.info(`Skipping SMTP send in test runtime for ${to}`);
        return { skipped: true };
    }

    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
    });

    if (!isProductionRuntime()) {
        logger.info('SMTP Config Loaded');
    }

    try {
        await transporter.verify();
    } catch (error) {
        const verifyError = new Error('Email service unavailable');
        verifyError.code = 'EMAIL_PROVIDER_UNAVAILABLE';
        verifyError.cause = error;
        throw verifyError;
    }
    let result;
    try {
        result = await transporter.sendMail({
            from: smtp.from,
            to,
            subject,
            text,
            html: options.html,
        });
    } catch (error) {
        const sendError = new Error('Email service unavailable');
        sendError.code = 'EMAIL_PROVIDER_UNAVAILABLE';
        sendError.cause = error;
        throw sendError;
    }

    if (!isProductionRuntime()) {
        logger.info({
            event: 'email_send_result',
            messageId: result?.messageId || null,
            accepted: Array.isArray(result?.accepted) ? result.accepted.length : 0,
            rejected: Array.isArray(result?.rejected) ? result.rejected.length : 0,
        });
    }

    return result;
};

sendEmail.hasSmtpConfig = hasSmtpConfig;

module.exports = sendEmail;
