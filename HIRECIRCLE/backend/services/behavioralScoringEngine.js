const Application = require('../models/Application');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const resolveDropOffPoints = ({ total, pending, shortlisted, hired, offerProposed }) => {
    const points = [];
    if (total >= 5 && safeDiv(pending, total) >= 0.5) {
        points.push('high_pending_after_apply');
    }
    if (total >= 5 && shortlisted > 0 && hired === 0) {
        points.push('post_shortlist_conversion_gap');
    }
    if (offerProposed > 0 && hired === 0) {
        points.push('offer_stage_abandonment');
    }
    if (!points.length) {
        points.push('none_detected');
    }
    return points;
};

const computeBehaviorMetrics = ({
    total = 0,
    pending = 0,
    shortlisted = 0,
    accepted = 0,
    hired = 0,
    rejected = 0,
    offerProposed = 0,
    avgResponseHours = 72,
    lastActivityAt = null,
}) => {
    const completionRate = clamp01(safeDiv(shortlisted + accepted + hired, Math.max(total, 1)));
    const successRate = clamp01(safeDiv(hired, Math.max(total, 1)));
    const rejectionDrag = clamp01(safeDiv(rejected, Math.max(total, 1)));
    const responseScore = clamp01(1 - safeDiv(avgResponseHours, 72));

    const daysSinceLastActivity = lastActivityAt
        ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000))
        : 999;
    const activityScore = clamp01(1 - safeDiv(daysSinceLastActivity, 30));

    const reliabilityScore = clamp01(
        (successRate * 0.45)
        + (completionRate * 0.25)
        + (responseScore * 0.2)
        + ((1 - rejectionDrag) * 0.1)
    );

    const engagementScore = clamp01(
        (activityScore * 0.5)
        + (clamp01(safeDiv(total, 20)) * 0.35)
        + (responseScore * 0.15)
    );

    return {
        responseTimeAvg: Number(avgResponseHours.toFixed(2)),
        completionRate: Number(completionRate.toFixed(4)),
        reliabilityScore: Number(reliabilityScore.toFixed(4)),
        engagementScore: Number(engagementScore.toFixed(4)),
        dropOffPoints: resolveDropOffPoints({
            total,
            pending,
            shortlisted,
            hired,
            offerProposed,
        }),
        transparency: {
            totalApplications: Number(total || 0),
            pendingApplications: Number(pending || 0),
            shortlistedApplications: Number(shortlisted || 0),
            acceptedApplications: Number(accepted || 0),
            hiredApplications: Number(hired || 0),
            rejectedApplications: Number(rejected || 0),
            offerProposedApplications: Number(offerProposed || 0),
            daysSinceLastActivity,
            responseScore: Number(responseScore.toFixed(4)),
            activityScore: Number(activityScore.toFixed(4)),
            successRate: Number(successRate.toFixed(4)),
            rejectionDrag: Number(rejectionDrag.toFixed(4)),
        },
    };
};

const buildBehaviorProfile = async ({ userId, upsert = true } = {}) => {
    if (!userId) {
        throw new Error('userId is required to build behavior profile');
    }

    const workerProfile = await WorkerProfile.findOne({ user: userId })
        .select('_id updatedAt')
        .lean();

    const since90d = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));

    const applications = workerProfile
        ? await Application.find({
            worker: workerProfile._id,
            createdAt: { $gte: since90d },
        })
            .select('status createdAt updatedAt')
            .sort({ updatedAt: -1 })
            .lean()
        : [];

    const total = applications.length;
    const pending = applications.filter((row) => ['applied', 'pending', 'requested'].includes(String(row.status || '').toLowerCase())).length;
    const shortlisted = applications.filter((row) => String(row.status || '').toLowerCase() === 'shortlisted').length;
    const accepted = applications.filter((row) => (
        [
            'interview_requested',
            'interview_completed',
            'offer_sent',
            'offer_accepted',
            // Legacy compatibility.
            'accepted',
        ].includes(String(row.status || '').toLowerCase())
    )).length;
    const hired = applications.filter((row) => String(row.status || '').toLowerCase() === 'hired').length;
    const rejected = applications.filter((row) => String(row.status || '').toLowerCase() === 'rejected').length;
    const offerProposed = applications.filter((row) => ['offer_sent', 'offer_proposed'].includes(String(row.status || '').toLowerCase())).length;

    const avgResponseHours = total
        ? applications.reduce((sum, row) => {
            const ms = Math.max(0, new Date(row.updatedAt || 0).getTime() - new Date(row.createdAt || 0).getTime());
            return sum + (ms / (1000 * 60 * 60));
        }, 0) / total
        : 72;

    const lastActivityAt = applications[0]?.updatedAt || workerProfile?.updatedAt || null;

    const metrics = computeBehaviorMetrics({
        total,
        pending,
        shortlisted,
        accepted,
        hired,
        rejected,
        offerProposed,
        avgResponseHours,
        lastActivityAt,
    });

    if (!upsert) {
        return {
            userId,
            ...metrics,
            computedAt: new Date(),
        };
    }

    const profile = await UserBehaviorProfile.findOneAndUpdate(
        { userId },
        {
            $set: {
                userId,
                ...metrics,
                computedAt: new Date(),
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return profile;
};

const getBehaviorProfile = async ({ userId, computeIfMissing = true } = {}) => {
    if (!userId) return null;

    const existing = await UserBehaviorProfile.findOne({ userId }).lean();
    if (existing) return existing;
    if (!computeIfMissing) return null;

    return buildBehaviorProfile({
        userId,
        upsert: true,
    });
};

const getBehaviorSignalsForMatch = ({ profile = null } = {}) => {
    if (!profile) {
        return {
            reliabilityBoost: 1,
            trustScore: 0.5,
            spamRisk: 0.5,
            explainability: {
                source: 'default',
            },
        };
    }

    const reliability = clamp01(profile.reliabilityScore || 0);
    const engagement = clamp01(profile.engagementScore || 0);
    const completion = clamp01(profile.completionRate || 0);

    const trustScore = clamp01((reliability * 0.45) + (completion * 0.3) + (engagement * 0.25));
    const spamRisk = clamp01(1 - ((trustScore * 0.7) + (completion * 0.3)));
    const reliabilityBoost = clamp(0.92 + (trustScore * 0.16), 0.92, 1.08);

    return {
        reliabilityBoost: Number(reliabilityBoost.toFixed(4)),
        trustScore: Number(trustScore.toFixed(4)),
        spamRisk: Number(spamRisk.toFixed(4)),
        explainability: {
            reliabilityScore: reliability,
            engagementScore: engagement,
            completionRate: completion,
        },
    };
};

module.exports = {
    buildBehaviorProfile,
    getBehaviorProfile,
    getBehaviorSignalsForMatch,
    computeBehaviorMetrics,
};
