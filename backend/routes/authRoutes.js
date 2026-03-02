const express = require('express');
const crypto = require('crypto');
const { validate } = require('../middleware/validate');

const User = require('../models/userModel');
const sendEmail = require('../utils/sendEmail');
const sendSms = require('../utils/sendSms');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const logger = require('../utils/logger');
const { resolveUserRoleContract } = require('../utils/userRoleContract');
const { incrementOtpFailureCounter } = require('../services/systemMonitoringService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { otpSendSchema, otpVerifySchema } = require('../schemas/requestSchemas');
const { createRedisRateLimiter, readIp } = require('../services/redisRateLimiter');

const router = express.Router();

const OTP_EXPIRY_MS = Number.parseInt(process.env.OTP_EXPIRY_MS || String(5 * 60 * 1000), 10);
const OTP_RESEND_COOLDOWN_MS = Number.parseInt(process.env.OTP_RESEND_COOLDOWN_MS || String(30 * 1000), 10);
const OTP_MAX_VERIFY_ATTEMPTS = Number.parseInt(process.env.OTP_MAX_VERIFY_ATTEMPTS || '5', 10);
const OTP_MAX_REQUESTS_PER_WINDOW = Number.parseInt(process.env.OTP_MAX_REQUESTS_PER_WINDOW || '3', 10);
const OTP_REQUEST_WINDOW_MS = Number.parseInt(process.env.OTP_REQUEST_WINDOW_MS || String(15 * 60 * 1000), 10);
const OTP_BLOCK_WINDOW_MS = Number.parseInt(process.env.OTP_BLOCK_WINDOW_MS || String(15 * 60 * 1000), 10);
const OTP_HMAC_SECRET = String(process.env.OTP_HMAC_SECRET || '').trim();

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim().replace(/[^\d+]/g, '');
const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const resolveOtpIdentity = (payload = {}) => {
    const email = normalizeEmail(payload.email);
    const phone = normalizePhone(payload.phone || payload.phoneNumber);

    if (email) {
        return {
            kind: 'email',
            normalized: email,
            query: { email },
        };
    }

    if (phone) {
        return {
            kind: 'phone',
            normalized: phone,
            query: { phoneNumber: phone },
        };
    }

    return null;
};

const limiterKey = (req) => {
    const identity = resolveOtpIdentity(req.body || {});
    const identityKey = identity ? `${identity.kind}:${identity.normalized}` : 'unknown';
    return `${readIp(req)}:${identityKey}`;
};

const sendOtpLimiter = createRedisRateLimiter({
    namespace: 'otp-send',
    windowMs: OTP_REQUEST_WINDOW_MS,
    max: Number.parseInt(process.env.OTP_SEND_RATE_LIMIT_PER_IDENTITY || '3', 10),
    keyGenerator: limiterKey,
    strictRedis: String(process.env.NODE_ENV || '').toLowerCase() === 'production',
    message: 'Too many OTP requests. Please try again later.',
});

const verifyOtpLimiter = createRedisRateLimiter({
    namespace: 'otp-verify',
    windowMs: OTP_REQUEST_WINDOW_MS,
    max: Number.parseInt(process.env.OTP_VERIFY_RATE_LIMIT_PER_IDENTITY || '20', 10),
    keyGenerator: limiterKey,
    strictRedis: String(process.env.NODE_ENV || '').toLowerCase() === 'production',
    message: 'Too many verification attempts. Please try again later.',
});

const hashOtp = (otp) => {
    if (!OTP_HMAC_SECRET) {
        throw new Error('OTP secret is not configured');
    }
    return crypto
        .createHmac('sha256', OTP_HMAC_SECRET)
        .update(String(otp))
        .digest('hex');
};

const secureOtpEquals = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const resetOtpState = (user) => {
    user.otpCodeHash = null;
    user.otpExpiry = null;
    user.otpAttemptCount = 0;
    user.otpBlockedUntil = null;
};

const hasSmtpConfig = () => Boolean(sendEmail.hasSmtpConfig?.());

const hasSmsConfig = () => Boolean(sendSms.hasSmsConfig?.());

const genericSuccessPayload = { message: 'If this account exists, OTP has been sent.' };

const sendOtpHandler = async (req, res) => {
    const identity = resolveOtpIdentity(req.body || {});
    if (!identity) {
        return res.status(400).json({ message: 'Email or phone is required' });
    }
    if (!OTP_HMAC_SECRET) {
        logger.error('OTP_HMAC_SECRET is missing; OTP service unavailable');
        return res.status(503).json({ message: 'OTP service is not configured.' });
    }
    if (identity.kind === 'email' && !hasSmtpConfig()) {
        return res.status(503).json({ message: 'Email OTP provider is not configured.' });
    }
    if (identity.kind === 'phone' && !hasSmsConfig()) {
        return res.status(503).json({ message: 'SMS OTP provider is not configured.' });
    }

    let user = null;
    let previousOtpState = null;

    try {
        user = await User.findOne(identity.query);
        if (!user || user.isDeleted) {
            return res.json(genericSuccessPayload);
        }

        const now = Date.now();
        if (user.otpBlockedUntil && new Date(user.otpBlockedUntil).getTime() > now) {
            await incrementOtpFailureCounter({ identity: identity.normalized });
            return res.status(429).json({ message: 'OTP temporarily blocked. Please try again later.' });
        }

        const lastSentAt = user.otpLastSentAt ? new Date(user.otpLastSentAt).getTime() : 0;
        if (lastSentAt && (now - lastSentAt) < OTP_RESEND_COOLDOWN_MS) {
            const retryAfterMs = OTP_RESEND_COOLDOWN_MS - (now - lastSentAt);
            return res.status(429).json({
                message: 'Please wait before requesting a new OTP.',
                retryAfterMs,
            });
        }

        const requestWindowStartedAt = user.otpRequestWindowStartedAt
            ? new Date(user.otpRequestWindowStartedAt).getTime()
            : 0;
        const resetWindowExpired = !requestWindowStartedAt || (now - requestWindowStartedAt) >= OTP_REQUEST_WINDOW_MS;
        const nextRequestCount = resetWindowExpired ? 1 : (Number(user.otpRequestCount || 0) + 1);
        if (nextRequestCount > OTP_MAX_REQUESTS_PER_WINDOW) {
            user.otpBlockedUntil = new Date(now + OTP_BLOCK_WINDOW_MS);
            await user.save({ validateBeforeSave: false });
            await incrementOtpFailureCounter({ identity: identity.normalized });
            void enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(user._id),
                    reason: 'otp_request_limit_exceeded',
                },
            }).catch(() => {});
            return res.status(429).json({ message: 'OTP request limit exceeded. Maximum 3 requests in 15 minutes.' });
        }

        const code = crypto.randomInt(100000, 1000000).toString();
        previousOtpState = {
            otpCodeHash: user.otpCodeHash,
            otpExpiry: user.otpExpiry,
            otpAttemptCount: user.otpAttemptCount,
            otpRequestCount: user.otpRequestCount,
            otpRequestWindowStartedAt: user.otpRequestWindowStartedAt,
            otpLastSentAt: user.otpLastSentAt,
            otpBlockedUntil: user.otpBlockedUntil,
        };

        user.otpCodeHash = hashOtp(code);
        user.otpExpiry = new Date(now + OTP_EXPIRY_MS);
        user.otpAttemptCount = 0;
        user.otpRequestCount = nextRequestCount;
        user.otpRequestWindowStartedAt = resetWindowExpired ? new Date(now) : user.otpRequestWindowStartedAt;
        user.otpLastSentAt = new Date(now);
        user.otpBlockedUntil = null;
        await user.save({ validateBeforeSave: false });

        if (identity.kind === 'email') {
            await sendEmail({
                email: identity.normalized,
                subject: 'Your HireCircle verification code',
                message: `Your verification code is ${code}. It will expire in 5 minutes.`,
            });
        } else {
            await sendSms({
                to: identity.normalized,
                message: `Your HireCircle verification code is ${code}. It expires in 5 minutes.`,
            });
        }

        return res.json(genericSuccessPayload);
    } catch (error) {
        if (user && previousOtpState) {
            try {
                user.otpCodeHash = previousOtpState.otpCodeHash;
                user.otpExpiry = previousOtpState.otpExpiry;
                user.otpAttemptCount = previousOtpState.otpAttemptCount;
                user.otpRequestCount = previousOtpState.otpRequestCount;
                user.otpRequestWindowStartedAt = previousOtpState.otpRequestWindowStartedAt;
                user.otpLastSentAt = previousOtpState.otpLastSentAt;
                user.otpBlockedUntil = previousOtpState.otpBlockedUntil;
                await user.save({ validateBeforeSave: false });
            } catch (rollbackError) {
                logger.error(`OTP rollback failed: ${rollbackError?.message || rollbackError}`);
            }
        }

        logger.warn(`Send OTP error: ${error?.message || error}`);
        const errorCode = String(error?.code || '').trim();
        const messageLower = String(error?.message || '').toLowerCase();

        if (identity.kind === 'email') {
            if (errorCode === 'EMAIL_PROVIDER_CONFIG_INVALID') {
                return res.status(503).json({ message: 'Email OTP provider is not configured.' });
            }
            if (errorCode === 'EMAIL_PROVIDER_UNAVAILABLE' || messageLower.includes('email service unavailable')) {
                return res.status(503).json({ message: 'Email service unavailable' });
            }
        }

        if (identity.kind === 'phone') {
            if (errorCode === 'SMS_PROVIDER_CONFIG_INVALID') {
                return res.status(503).json({ message: 'SMS OTP provider is not configured.' });
            }
            if (errorCode === 'SMS_PROVIDER_UNAVAILABLE' || messageLower.includes('sms service unavailable')) {
                return res.status(503).json({ message: 'SMS service unavailable' });
            }
        }

        return res.status(500).json({ message: 'Failed to send OTP. Try again later.' });
    }
};

router.post('/send-otp', sendOtpLimiter, validate({ body: otpSendSchema }), sendOtpHandler);
router.post('/resend-otp', sendOtpLimiter, validate({ body: otpSendSchema }), sendOtpHandler);

router.post('/verify-otp', verifyOtpLimiter, validate({ body: otpVerifySchema }), async (req, res) => {
    const { otp } = req.body || {};
    const identity = resolveOtpIdentity(req.body || {});
    const intent = String(req.body?.intent || '').trim().toLowerCase();

    if (!identity || !otp) {
        return res.status(400).json({ message: 'Email or phone and OTP are required' });
    }
    if (!OTP_HMAC_SECRET) {
        logger.error('OTP_HMAC_SECRET is missing; OTP verification unavailable');
        return res.status(503).json({ message: 'OTP service is not configured.' });
    }

    try {
        const user = await User.findOne(identity.query);
        if (!user || user.isDeleted) {
            return res.status(400).json({ message: 'Invalid or expired code' });
        }

        const now = Date.now();
        if (user.otpBlockedUntil && new Date(user.otpBlockedUntil).getTime() > now) {
            await incrementOtpFailureCounter({ identity: identity.normalized });
            return res.status(429).json({ message: 'Too many invalid attempts. Try again later.' });
        }

        const isExpired = !user.otpExpiry || new Date(user.otpExpiry).getTime() <= now;
        if (isExpired) {
            resetOtpState(user);
            await user.save({ validateBeforeSave: false });
            await incrementOtpFailureCounter({ identity: identity.normalized });
            return res.status(400).json({ message: 'Invalid or expired code' });
        }

        const incomingOtp = String(otp).trim();
        const incomingOtpHash = hashOtp(incomingOtp);
        const isValid = secureOtpEquals(incomingOtpHash, user.otpCodeHash);
        if (!isValid) {
            user.otpAttemptCount = Number(user.otpAttemptCount || 0) + 1;
            if (user.otpAttemptCount >= OTP_MAX_VERIFY_ATTEMPTS) {
                user.otpBlockedUntil = new Date(now + OTP_BLOCK_WINDOW_MS);
            }
            await user.save({ validateBeforeSave: false });
            await incrementOtpFailureCounter({ identity: identity.normalized });
            void enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(user._id),
                    reason: 'otp_invalid_attempt',
                },
            }).catch(() => {});
            return res.status(400).json({ message: 'Invalid or expired code' });
        }

        if (identity.kind === 'email') {
            user.isEmailVerified = true;
        }
        user.isVerified = true;
        resetOtpState(user);
        await user.save({ validateBeforeSave: false });

        setImmediate(async () => {
            try {
                await trackFunnelStage({
                    userId: user._id,
                    stage: 'otp',
                    source: 'verify_otp',
                    metadata: {
                        identityKind: identity.kind,
                        intent: intent || null,
                    },
                });
                await recordFeatureUsage({
                    userId: user._id,
                    featureKey: 'otp_verified',
                });
            } catch (metricError) {
                logger.warn(`OTP growth tracking failed: ${metricError?.message || metricError}`);
            }
        });

        if (intent === 'signup' || intent === 'signin' || intent === 'login') {
            const roleContract = resolveUserRoleContract(user);
            return res.json({
                message: 'Verification successful',
                _id: user._id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber || null,
                role: roleContract.role,
                roles: roleContract.roles,
                activeRole: roleContract.activeRole,
                primaryRole: roleContract.primaryRole,
                capabilities: roleContract.capabilities,
                hasSelectedRole: true,
                hasCompletedProfile: Boolean(user.hasCompletedProfile),
                isVerified: Boolean(user.isVerified),
                isAdmin: Boolean(user.isAdmin),
                token: generateToken(user._id, { tokenVersion: resolveTokenVersion(user.tokenVersion) }),
                refreshToken: generateRefreshToken(user._id, { tokenVersion: resolveTokenVersion(user.tokenVersion) }),
            });
        }

        return res.json({ message: 'Verification successful' });
    } catch (error) {
        logger.warn(`Verify OTP error: ${error?.message || error}`);
        return res.status(500).json({ message: 'Failed to verify OTP' });
    }
});

module.exports = router;
