const Application = require('../models/Application');
const InterviewQualityScore = require('../models/InterviewQualityScore');
const Notification = require('../models/Notification');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const UserChurnRiskModel = require('../models/UserChurnRiskModel');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const NUDGE_COOLDOWN_DAYS = 7;

const resolveRiskLevel = (score) => {
    if (score >= 0.72) return 'HIGH';
    if (score >= 0.5) return 'MEDIUM';
    return 'LOW';
};

const resolveRecommendedAction = ({ riskLevel, inactivityDays, applicationSuccessRate, interviewCompletionRate }) => {
    if (riskLevel !== 'HIGH') return 'none';

    if (inactivityDays >= 14) return 'targeted_nudge';
    if (applicationSuccessRate < 0.15) return 'smart_notification';
    if (interviewCompletionRate < 0.5) return 'contextual_reminder';

    return 'smart_notification';
};

const buildNudgePayload = ({ action, inactivityDays }) => {
    if (action === 'targeted_nudge') {
        return {
            title: 'New opportunities waiting',
            message: inactivityDays >= 21
                ? 'Your profile is still active. Apply to one relevant role to restart momentum.'
                : 'A quick profile refresh can improve your match quality today.',
        };
    }

    if (action === 'smart_notification') {
        return {
            title: 'Improve your hiring outcomes',
            message: 'Try applying to roles aligned with your top skills for faster shortlisting.',
        };
    }

    if (action === 'contextual_reminder') {
        return {
            title: 'Complete interview details',
            message: 'Completing missing interview sections increases trust and match visibility.',
        };
    }

    return null;
};

const maybeSendNudge = async ({ userId, action, inactivityDays }) => {
    if (!userId || action === 'none') return { sent: false, reason: 'action_none' };

    const cooldownFrom = new Date(Date.now() - (NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000));

    const recent = await Notification.findOne({
        user: userId,
        type: 'status_update',
        'relatedData.nudgeType': 'churn_risk_guarded',
        createdAt: { $gte: cooldownFrom },
    })
        .select('_id createdAt')
        .lean();

    if (recent) {
        return {
            sent: false,
            reason: 'cooldown_active',
            lastNudgeAt: recent.createdAt,
        };
    }

    const payload = buildNudgePayload({ action, inactivityDays });
    if (!payload) {
        return { sent: false, reason: 'no_payload' };
    }

    const created = await Notification.create({
        user: userId,
        type: 'status_update',
        title: payload.title,
        message: payload.message,
        relatedData: {
            nudgeType: 'churn_risk_guarded',
            action,
        },
    });

    return {
        sent: true,
        reason: 'sent',
        lastNudgeAt: created.createdAt,
    };
};

const evaluateUserChurnRisk = async ({
    userId,
    triggerNudge = true,
}) => {
    if (!userId) {
        throw new Error('userId is required for churn risk evaluation');
    }

    const worker = await WorkerProfile.findOne({ user: userId })
        .select('_id updatedAt')
        .lean();

    const behavior = await UserBehaviorProfile.findOne({ userId }).lean();

    const applications = worker
        ? await Application.find({ worker: worker._id })
            .select('status createdAt updatedAt')
            .sort({ updatedAt: -1 })
            .limit(300)
            .lean()
        : [];

    const qualityRows = await InterviewQualityScore.find({ userId })
        .select('overallQualityScore createdAt')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

    const latestActivityAt = applications[0]?.updatedAt || behavior?.computedAt || worker?.updatedAt || null;
    const inactivityDays = latestActivityAt
        ? Math.max(0, Math.floor((Date.now() - new Date(latestActivityAt).getTime()) / (24 * 60 * 60 * 1000)))
        : 999;

    const totalApplications = applications.length;
    const hiredCount = applications.filter((row) => String(row.status || '').toLowerCase() === 'hired').length;
    const shortlistedCount = applications.filter((row) => String(row.status || '').toLowerCase() === 'shortlisted').length;

    const applicationSuccessRate = clamp01(safeDiv(hiredCount + (shortlistedCount * 0.5), Math.max(totalApplications, 1)));

    const interviewCompletionRate = qualityRows.length
        ? clamp01(qualityRows.reduce((sum, row) => sum + Number(row.overallQualityScore || 0), 0) / qualityRows.length)
        : 0.45;

    const engagementScore = clamp01(behavior?.engagementScore || 0.4);

    const inactivityRisk = clamp01(safeDiv(inactivityDays, 30));
    const successRisk = clamp01(1 - applicationSuccessRate);
    const interviewRisk = clamp01(1 - interviewCompletionRate);
    const engagementRisk = clamp01(1 - engagementScore);

    const churnRiskScore = clamp01(
        (inactivityRisk * 0.35)
        + (successRisk * 0.25)
        + (interviewRisk * 0.2)
        + (engagementRisk * 0.2)
    );

    const churnRiskLevel = resolveRiskLevel(churnRiskScore);
    const recommendedAction = resolveRecommendedAction({
        riskLevel: churnRiskLevel,
        inactivityDays,
        applicationSuccessRate,
        interviewCompletionRate,
    });

    let nudgeResult = { sent: false, reason: 'disabled' };
    if (triggerNudge && churnRiskLevel === 'HIGH' && recommendedAction !== 'none') {
        nudgeResult = await maybeSendNudge({
            userId,
            action: recommendedAction,
            inactivityDays,
        });
    }

    const persisted = await UserChurnRiskModel.findOneAndUpdate(
        { userId },
        {
            $set: {
                userId,
                inactivityDays,
                applicationSuccessRate: Number(applicationSuccessRate.toFixed(4)),
                interviewCompletionRate: Number(interviewCompletionRate.toFixed(4)),
                engagementScore: Number(engagementScore.toFixed(4)),
                churnRiskScore: Number(churnRiskScore.toFixed(4)),
                churnRiskLevel,
                recommendedAction,
                computedAt: new Date(),
                ...(nudgeResult.sent ? { lastNudgeAt: nudgeResult.lastNudgeAt } : {}),
                explainability: {
                    inactivityRisk: Number(inactivityRisk.toFixed(4)),
                    successRisk: Number(successRisk.toFixed(4)),
                    interviewRisk: Number(interviewRisk.toFixed(4)),
                    engagementRisk: Number(engagementRisk.toFixed(4)),
                    nudgeResult,
                    safeNoSpamCooldownDays: NUDGE_COOLDOWN_DAYS,
                },
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return persisted;
};

module.exports = {
    evaluateUserChurnRisk,
    resolveRiskLevel,
    resolveRecommendedAction,
    NUDGE_COOLDOWN_DAYS,
};
