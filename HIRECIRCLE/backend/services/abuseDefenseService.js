const Application = require('../models/Application');
const { AbuseSignal } = require('../models/AbuseSignal');
const Job = require('../models/Job');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const { recomputeTrustGraphForUser } = require('./trustGraphService');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeSkill = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => String(value || '').trim().toLowerCase();

const detectMassJobPostingSpam = async ({ userId }) => {
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));

    const [jobCount, titleRows] = await Promise.all([
        Job.countDocuments({ employerId: userId, createdAt: { $gte: oneHourAgo } }),
        Job.aggregate([
            { $match: { employerId: userId, createdAt: { $gte: oneHourAgo } } },
            {
                $group: {
                    _id: { title: '$title', location: '$location', salaryRange: '$salaryRange' },
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
            { $limit: 1 },
        ]),
    ]);

    const maxDuplicateCount = Number(titleRows[0]?.count || 0);
    const duplicateRatio = jobCount > 0 ? (maxDuplicateCount / jobCount) : 0;

    const score = clamp((jobCount * 8) + (duplicateRatio * 40), 0, 100);
    const triggered = jobCount >= 8 || duplicateRatio >= 0.75;

    return triggered
        ? {
            signalType: 'mass_job_posting_spam',
            score,
            reason: 'High-volume repetitive job posting pattern',
            evidence: {
                jobCountLastHour: jobCount,
                duplicateRatio: Number(duplicateRatio.toFixed(4)),
            },
        }
        : null;
};

const detectBotLikeApplyBehavior = async ({ userId }) => {
    const worker = await WorkerProfile.findOne({ user: userId }).select('_id').lean();
    if (!worker?._id) return null;

    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
    const oneDayAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));

    const [hourCount, dayRows] = await Promise.all([
        Application.countDocuments({ worker: worker._id, createdAt: { $gte: oneHourAgo } }),
        Application.aggregate([
            { $match: { worker: worker._id, createdAt: { $gte: oneDayAgo } } },
            {
                $group: {
                    _id: {
                        hour: { $hour: '$createdAt' },
                    },
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const peakHour = dayRows.reduce((max, row) => Math.max(max, Number(row.count || 0)), 0);
    const score = clamp((hourCount * 6) + (peakHour * 2), 0, 100);
    const triggered = hourCount >= 25 || peakHour >= 30;

    return triggered
        ? {
            signalType: 'bot_like_apply_behavior',
            score,
            reason: 'Application velocity indicates bot-like behavior',
            evidence: {
                hourCount,
                peakHour,
            },
        }
        : null;
};

const detectSuspiciousOtpAttempts = async ({ user }) => {
    if (!user) return null;

    const totalOtpActions = Number(user.otpAttemptCount || 0) + Number(user.otpRequestCount || 0);
    const hasBlock = Boolean(user.otpBlockedUntil && new Date(user.otpBlockedUntil).getTime() > Date.now());
    const score = clamp((totalOtpActions * 7) + (hasBlock ? 35 : 0), 0, 100);
    const triggered = totalOtpActions >= 8 || hasBlock;

    return triggered
        ? {
            signalType: 'suspicious_otp_attempts',
            score,
            reason: 'OTP abuse pattern detected',
            evidence: {
                otpAttemptCount: Number(user.otpAttemptCount || 0),
                otpRequestCount: Number(user.otpRequestCount || 0),
                otpBlockedUntil: user.otpBlockedUntil || null,
            },
        }
        : null;
};

const detectRapidAccountCreation = async ({ user }) => {
    if (!user?.createdAt) return null;

    const windowStart = new Date(new Date(user.createdAt).getTime() - (10 * 60 * 1000));
    const windowEnd = new Date(new Date(user.createdAt).getTime() + (10 * 60 * 1000));

    const recentCount = await User.countDocuments({
        createdAt: { $gte: windowStart, $lte: windowEnd },
        acquisitionCity: user.acquisitionCity || null,
        acquisitionSource: user.acquisitionSource || 'unknown',
    });

    const score = clamp((recentCount - 1) * 8, 0, 100);
    const triggered = recentCount >= 12;

    return triggered
        ? {
            signalType: 'rapid_account_creation',
            score,
            reason: 'Burst account creation pattern detected',
            evidence: {
                acquisitionCity: user.acquisitionCity || null,
                acquisitionSource: user.acquisitionSource || 'unknown',
                cohortCount: recentCount,
            },
        }
        : null;
};

const detectDuplicateProfilePattern = async ({ userId }) => {
    const worker = await WorkerProfile.findOne({ user: userId })
        .select('firstName city roleProfiles')
        .lean();
    if (!worker) return null;

    const anchorName = normalizeText(worker.firstName);
    const anchorCity = normalizeText(worker.city);
    const anchorSkills = new Set(
        (Array.isArray(worker.roleProfiles) ? worker.roleProfiles : [])
            .flatMap((row) => Array.isArray(row.skills) ? row.skills : [])
            .map(normalizeSkill)
            .filter(Boolean)
    );

    if (!anchorName || !anchorCity || anchorSkills.size < 2) return null;

    const candidates = await WorkerProfile.find({
        firstName: new RegExp(`^${anchorName}$`, 'i'),
        city: new RegExp(`^${anchorCity}$`, 'i'),
    })
        .select('_id user roleProfiles')
        .limit(50)
        .lean();

    let lookalikeCount = 0;
    for (const candidate of candidates) {
        if (String(candidate.user) === String(userId)) continue;

        const candidateSkills = new Set(
            (Array.isArray(candidate.roleProfiles) ? candidate.roleProfiles : [])
                .flatMap((row) => Array.isArray(row.skills) ? row.skills : [])
                .map(normalizeSkill)
                .filter(Boolean)
        );

        const overlap = [...anchorSkills].filter((skill) => candidateSkills.has(skill)).length;
        if (overlap >= 2) {
            lookalikeCount += 1;
        }
    }

    const score = clamp(lookalikeCount * 20, 0, 100);
    const triggered = lookalikeCount >= 3;

    return triggered
        ? {
            signalType: 'duplicate_profile_pattern',
            score,
            reason: 'Multiple highly similar profiles detected',
            evidence: {
                lookalikeCount,
                anchorName,
                anchorCity,
            },
        }
        : null;
};

const upsertAbuseSignal = async ({ userId, signal }) => {
    const sixHoursAgo = new Date(Date.now() - (6 * 60 * 60 * 1000));

    const existing = await AbuseSignal.findOne({
        userId,
        signalType: signal.signalType,
        detectedAt: { $gte: sixHoursAgo },
        status: { $in: ['open', 'blocked'] },
    });

    if (existing) {
        existing.score = Math.max(Number(existing.score || 0), Number(signal.score || 0));
        existing.reason = signal.reason;
        existing.evidence = {
            ...(existing.evidence || {}),
            ...(signal.evidence || {}),
        };
        await existing.save();
        return existing;
    }

    return AbuseSignal.create({
        userId,
        signalType: signal.signalType,
        score: signal.score,
        reason: signal.reason,
        evidence: signal.evidence,
        status: 'open',
        blocked: false,
        detectedAt: new Date(),
    });
};

const applyAutomaticBlockIfNeeded = async ({ userId, maxScore, signals = [] }) => {
    const shouldBlock = Number(maxScore || 0) >= 80;
    if (!shouldBlock) {
        return {
            blocked: false,
            banned: false,
        };
    }

    const shouldBan = Number(maxScore || 0) >= 95;

    await User.findByIdAndUpdate(userId, {
        $set: {
            isFlagged: true,
            trustStatus: 'restricted',
            actionLimitsUntil: new Date(Date.now() + (24 * 60 * 60 * 1000)),
            ...(shouldBan
                ? {
                    isBanned: true,
                    banReason: 'Automated abuse defense block',
                    bannedAt: new Date(),
                }
                : {}),
        },
    });

    await AbuseSignal.updateMany(
        {
            userId,
            signalType: { $in: signals.map((row) => row.signalType) },
            status: 'open',
        },
        {
            $set: {
                status: 'blocked',
                blocked: true,
            },
        }
    );

    return {
        blocked: true,
        banned: shouldBan,
    };
};

const evaluateUserAbuseSignals = async ({ userId, autoBlock = true }) => {
    if (!userId) return { blocked: false, signals: [] };

    const user = await User.findById(userId)
        .select('otpAttemptCount otpRequestCount otpBlockedUntil acquisitionCity acquisitionSource createdAt')
        .lean();
    if (!user) return { blocked: false, signals: [] };

    const detections = (await Promise.all([
        detectMassJobPostingSpam({ userId }),
        detectBotLikeApplyBehavior({ userId }),
        detectSuspiciousOtpAttempts({ user }),
        detectRapidAccountCreation({ user }),
        detectDuplicateProfilePattern({ userId }),
    ])).filter(Boolean);

    const persisted = [];
    for (const signal of detections) {
        const row = await upsertAbuseSignal({ userId, signal });
        persisted.push(row);
    }

    const maxScore = persisted.reduce((max, row) => Math.max(max, Number(row.score || 0)), 0);
    const blockResult = autoBlock
        ? await applyAutomaticBlockIfNeeded({ userId, maxScore, signals: detections })
        : { blocked: false, banned: false };

    if (detections.length) {
        await recomputeTrustGraphForUser({
            userId,
            reason: 'abuse_signal_detected',
        }).catch(() => {});
    }

    return {
        blocked: Boolean(blockResult.blocked),
        banned: Boolean(blockResult.banned),
        maxScore,
        signals: persisted.map((row) => ({
            signalType: row.signalType,
            score: row.score,
            status: row.status,
            blocked: row.blocked,
            detectedAt: row.detectedAt,
        })),
    };
};

const enforceAbuseAction = async ({ userId, action = 'unknown' }) => {
    const result = await evaluateUserAbuseSignals({ userId, autoBlock: true });

    if (!result.blocked) {
        return {
            allowed: true,
            reason: null,
            result,
        };
    }

    return {
        allowed: false,
        reason: `Action blocked by abuse defense (${action})`,
        result,
    };
};

module.exports = {
    evaluateUserAbuseSignals,
    enforceAbuseAction,
};
