const Application = require('../models/Application');
const Job = require('../models/Job');
const MarketAnomaly = require('../models/MarketAnomaly');
const Message = require('../models/Message');
const User = require('../models/userModel');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const upsertSecurityAnomaly = async ({
    signature,
    type,
    city = 'global',
    severity = 'medium',
    value = 0,
    baseline = 0,
    threshold = 0,
    detectedAt = new Date(),
    message,
    metadata = {},
}) => {
    const row = await MarketAnomaly.findOneAndUpdate(
        { signature },
        {
            $setOnInsert: {
                signature,
                type,
                city,
                severity,
                value,
                baseline,
                threshold,
                detectedAt,
                message,
                metadata: {
                    ...metadata,
                    flaggedForAdminReview: true,
                },
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return row;
};

const detectOtpAbuseSpikes = async ({ day = new Date() }) => {
    const from24h = new Date(day.getTime() - (24 * 60 * 60 * 1000));

    const rows = await User.aggregate([
        {
            $match: {
                updatedAt: { $gte: from24h, $lte: day },
                $or: [
                    { otpRequestCount: { $gte: 8 } },
                    { otpAttemptCount: { $gte: 8 } },
                    { otpBlockedUntil: { $gte: from24h } },
                ],
            },
        },
        {
            $project: {
                city: { $ifNull: ['$city', 'global'] },
                pressure: {
                    $add: [
                        { $ifNull: ['$otpRequestCount', 0] },
                        { $ifNull: ['$otpAttemptCount', 0] },
                    ],
                },
            },
        },
        {
            $group: {
                _id: '$city',
                usersFlagged: { $sum: 1 },
                pressure: { $sum: '$pressure' },
            },
        },
        {
            $match: {
                usersFlagged: { $gte: 5 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of rows) {
        const city = String(row._id || 'global');
        const usersFlagged = Number(row.usersFlagged || 0);
        anomalies.push(await upsertSecurityAnomaly({
            signature: `OTP_ABUSE_SPIKE:${city}:${day.toISOString().slice(0, 10)}`,
            type: 'OTP_ABUSE_SPIKE',
            city,
            severity: usersFlagged >= 15 ? 'critical' : 'high',
            value: usersFlagged,
            baseline: 2,
            threshold: 5,
            detectedAt: day,
            message: `OTP abuse spike detected in ${city}: ${usersFlagged} accounts exceeded guardrail thresholds.`,
            metadata: {
                aggregatePressure: Number(row.pressure || 0),
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectMessageSpamBursts = async ({ day = new Date() }) => {
    const from1h = new Date(day.getTime() - (60 * 60 * 1000));

    const rows = await Message.aggregate([
        {
            $match: {
                createdAt: { $gte: from1h, $lte: day },
            },
        },
        {
            $group: {
                _id: '$sender',
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gte: 40 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of rows) {
        const senderId = String(row._id || 'unknown');
        const count = Number(row.count || 0);

        anomalies.push(await upsertSecurityAnomaly({
            signature: `MESSAGE_SPAM_BURST:${senderId}:${day.toISOString().slice(0, 13)}`,
            type: 'MESSAGE_SPAM_BURST',
            city: 'global',
            severity: count >= 80 ? 'critical' : 'high',
            value: count,
            baseline: 10,
            threshold: 40,
            detectedAt: day,
            message: `Message spam burst detected for sender ${senderId}: ${count} messages in the last hour.`,
            metadata: {
                senderId,
                lookbackHours: 1,
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectFakeJobPatterns = async ({ day = new Date() }) => {
    const from48h = new Date(day.getTime() - (48 * 60 * 60 * 1000));

    const rows = await Job.aggregate([
        {
            $match: {
                createdAt: { $gte: from48h, $lte: day },
                status: 'active',
            },
        },
        {
            $project: {
                employerId: 1,
                city: { $ifNull: ['$location', 'global'] },
                suspicious: {
                    $add: [
                        {
                            $cond: [
                                { $lt: [{ $size: { $ifNull: ['$requirements', []] } }, 2] },
                                1,
                                0,
                            ],
                        },
                        {
                            $cond: [
                                { $gt: [{ $ifNull: ['$maxSalary', 0] }, 300000] },
                                1,
                                0,
                            ],
                        },
                        {
                            $cond: [
                                {
                                    $regexMatch: {
                                        input: { $toLower: { $ifNull: ['$companyName', ''] } },
                                        regex: escapeRegex('test'),
                                    },
                                },
                                1,
                                0,
                            ],
                        },
                    ],
                },
            },
        },
        {
            $match: {
                suspicious: { $gte: 2 },
            },
        },
        {
            $group: {
                _id: {
                    employerId: '$employerId',
                    city: '$city',
                },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gte: 3 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of rows) {
        const employerId = String(row._id?.employerId || 'unknown');
        const city = String(row._id?.city || 'global');
        const count = Number(row.count || 0);

        anomalies.push(await upsertSecurityAnomaly({
            signature: `FAKE_JOB_PATTERN:${employerId}:${city}:${day.toISOString().slice(0, 10)}`,
            type: 'FAKE_JOB_PATTERN',
            city,
            severity: count >= 8 ? 'critical' : 'high',
            value: count,
            baseline: 1,
            threshold: 3,
            detectedAt: day,
            message: `Potential fake job pattern detected for employer ${employerId} in ${city}.`,
            metadata: {
                employerId,
                suspiciousJobs: count,
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectDuplicateAccountPatterns = async ({ day = new Date() }) => {
    const from7d = new Date(day.getTime() - (7 * 24 * 60 * 60 * 1000));

    const rows = await User.aggregate([
        {
            $match: {
                createdAt: { $gte: from7d, $lte: day },
                phoneNumber: { $type: 'string', $ne: '' },
            },
        },
        {
            $group: {
                _id: {
                    phoneNumber: '$phoneNumber',
                    city: { $ifNull: ['$city', 'global'] },
                },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gte: 3 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of rows) {
        const phone = String(row._id?.phoneNumber || 'unknown');
        const city = String(row._id?.city || 'global');
        const count = Number(row.count || 0);

        anomalies.push(await upsertSecurityAnomaly({
            signature: `DUPLICATE_ACCOUNT_PATTERN:${phone}:${city}:${day.toISOString().slice(0, 10)}`,
            type: 'DUPLICATE_ACCOUNT_PATTERN',
            city,
            severity: count >= 6 ? 'critical' : 'high',
            value: count,
            baseline: 1,
            threshold: 3,
            detectedAt: day,
            message: `Duplicate account pattern detected for phone ${phone} in ${city}.`,
            metadata: {
                phone,
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectBotLikeActivity = async ({ day = new Date() }) => {
    const from2h = new Date(day.getTime() - (2 * 60 * 60 * 1000));

    const applicationRows = await Application.aggregate([
        {
            $match: {
                createdAt: { $gte: from2h, $lte: day },
            },
        },
        {
            $group: {
                _id: '$worker',
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gte: 18 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of applicationRows) {
        const workerId = String(row._id || 'unknown');
        const count = Number(row.count || 0);

        anomalies.push(await upsertSecurityAnomaly({
            signature: `BOT_LIKE_ACTIVITY:${workerId}:${day.toISOString().slice(0, 13)}`,
            type: 'BOT_LIKE_ACTIVITY',
            city: 'global',
            severity: count >= 40 ? 'critical' : 'high',
            value: count,
            baseline: 4,
            threshold: 18,
            detectedAt: day,
            message: `Bot-like activity pattern detected for worker ${workerId}.`,
            metadata: {
                workerId,
                applicationBurst2h: count,
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectSecurityAnomalies = async ({ day = new Date() } = {}) => {
    const [otp, spam, fakeJobs, duplicateAccounts, botLike] = await Promise.all([
        detectOtpAbuseSpikes({ day }),
        detectMessageSpamBursts({ day }),
        detectFakeJobPatterns({ day }),
        detectDuplicateAccountPatterns({ day }),
        detectBotLikeActivity({ day }),
    ]);

    return [...otp, ...spam, ...fakeJobs, ...duplicateAccounts, ...botLike].filter(Boolean);
};

module.exports = {
    detectSecurityAnomalies,
};
