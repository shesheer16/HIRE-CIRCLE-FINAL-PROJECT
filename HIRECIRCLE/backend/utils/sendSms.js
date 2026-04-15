const logger = require('./logger');
const axios = require('axios');

const isProductionRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const isTestRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'test';
const TEST_NUMBER_PATTERN = /^\+?1500555\d{4}$/;
const PLACEHOLDER_VALUE_PATTERN = /^(change_me|default|secret|replace_me|your_|<.+>)$/i;
const PLACEHOLDER_SMS_VALUE_PATTERN = /(example|dummy|placeholder|sandbox|test)/i;

const isPlaceholderLike = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return true;
    if (PLACEHOLDER_VALUE_PATTERN.test(normalized)) return true;
    return PLACEHOLDER_SMS_VALUE_PATTERN.test(normalized);
};

const getTwilioClient = () => {
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const fromPhone = String(process.env.TWILIO_FROM_PHONE || '').trim();

    const missing = [];
    if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!fromPhone) missing.push('TWILIO_FROM_PHONE');

    if (missing.length) {
        const error = new Error(`Missing SMS configuration: ${missing.join(', ')}`);
        error.code = 'SMS_PROVIDER_CONFIG_INVALID';
        throw error;
    }

    if (!isTestRuntime()) {
        if (isPlaceholderLike(accountSid)) {
            const error = new Error('TWILIO_ACCOUNT_SID must be a real account SID');
            error.code = 'SMS_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(authToken)) {
            const error = new Error('TWILIO_AUTH_TOKEN must be a real auth token');
            error.code = 'SMS_PROVIDER_CONFIG_INVALID';
            throw error;
        }
        if (isPlaceholderLike(fromPhone) || !/^\+\d{10,15}$/.test(fromPhone) || TEST_NUMBER_PATTERN.test(fromPhone)) {
            const error = new Error('TWILIO_FROM_PHONE must be a valid non-test sender');
            error.code = 'SMS_PROVIDER_CONFIG_INVALID';
            throw error;
        }
    }

    if (isProductionRuntime()) {
        if (!/^AC[a-f0-9]{32}$/i.test(accountSid)) {
            throw new Error('TWILIO_ACCOUNT_SID must be a real production account SID');
        }
        if (authToken.length < 24 || /(test|sandbox|example)/i.test(authToken)) {
            throw new Error('TWILIO_AUTH_TOKEN appears to be non-production');
        }
        if (!/^\+\d{10,15}$/.test(fromPhone) || TEST_NUMBER_PATTERN.test(fromPhone)) {
            throw new Error('TWILIO_FROM_PHONE must be a valid non-test production sender');
        }
    }

    return {
        accountSid,
        authToken,
        fromPhone,
    };
};

const sendSms = async ({ to, message }) => {
    const toPhone = String(to || '').trim();
    const body = String(message || '').trim();
    if (!toPhone || !body) {
        throw new Error('sendSms requires to and message');
    }

    if (isTestRuntime() && String(process.env.SMS_SKIP_SEND || '').toLowerCase() === 'true') {
        logger.info(`Skipping SMS send in test runtime for ${toPhone}`);
        return;
    }

    const { accountSid, authToken, fromPhone } = getTwilioClient();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({
        From: fromPhone,
        To: toPhone,
        Body: body,
    });

    try {
        await axios.post(url, params.toString(), {
            auth: {
                username: accountSid,
                password: authToken,
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 8000,
        });
    } catch (error) {
        const smsError = new Error('SMS service unavailable');
        smsError.code = 'SMS_PROVIDER_UNAVAILABLE';
        smsError.cause = error;
        throw smsError;
    }
};

const hasSmsConfig = () => {
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
    const fromPhone = String(process.env.TWILIO_FROM_PHONE || '').trim();
    return Boolean(
        accountSid
        && authToken
        && fromPhone
        && !isPlaceholderLike(accountSid)
        && !isPlaceholderLike(authToken)
        && !isPlaceholderLike(fromPhone)
        && /^\+\d{10,15}$/.test(fromPhone)
        && !TEST_NUMBER_PATTERN.test(fromPhone)
    );
};

sendSms.hasSmsConfig = hasSmsConfig;

module.exports = sendSms;
