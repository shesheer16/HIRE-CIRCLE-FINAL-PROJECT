const GrowthFunnelEvent = require('../models/GrowthFunnelEvent');

const FUNNEL_STAGES = ['signup', 'otp', 'interview', 'profile_complete', 'apply', 'interview_completed', 'offer', 'chat', 'hire'];

const trackFunnelStage = async ({ userId, stage, source = 'system', metadata = {} }) => {
    if (!userId || !FUNNEL_STAGES.includes(String(stage || '').toLowerCase())) {
        return { tracked: false };
    }

    const normalizedStage = String(stage).toLowerCase();
    const result = await GrowthFunnelEvent.updateOne(
        { user: userId, stage: normalizedStage },
        {
            $setOnInsert: {
                user: userId,
                stage: normalizedStage,
                source,
                metadata,
                occurredAt: new Date(),
            },
            $set: {
                source,
                metadata,
            },
        },
        { upsert: true }
    );

    return {
        tracked: Boolean(result?.upsertedCount || result?.modifiedCount),
        stage: normalizedStage,
    };
};

const getFunnelVisualization = async ({ from = null, to = null } = {}) => {
    const match = {};
    if (from || to) {
        match.occurredAt = {};
        if (from) match.occurredAt.$gte = new Date(from);
        if (to) match.occurredAt.$lte = new Date(to);
    }

    const rows = await GrowthFunnelEvent.aggregate([
        Object.keys(match).length ? { $match: match } : { $match: {} },
        {
            $group: {
                _id: '$stage',
                users: { $addToSet: '$user' },
            },
        },
        {
            $project: {
                _id: 1,
                count: { $size: '$users' },
            },
        },
    ]);

    const byStage = rows.reduce((acc, row) => {
        acc[String(row._id)] = Number(row.count || 0);
        return acc;
    }, {});

    const stages = FUNNEL_STAGES.map((stage, index) => {
        const count = Number(byStage[stage] || 0);
        const prevStage = index > 0 ? FUNNEL_STAGES[index - 1] : null;
        const prevCount = prevStage ? Number(byStage[prevStage] || 0) : count;
        const dropOff = prevStage ? Math.max(0, prevCount - count) : 0;
        const conversionFromPrev = prevStage && prevCount > 0 ? Number((count / prevCount).toFixed(4)) : 1;

        return {
            stage,
            count,
            dropOff,
            conversionFromPrev,
        };
    });

    return {
        stages,
        summary: {
            signup: Number(byStage.signup || 0),
            hire: Number(byStage.hire || 0),
            fullFunnelConversion: Number(byStage.signup || 0) > 0
                ? Number(((Number(byStage.hire || 0) / Number(byStage.signup || 0))).toFixed(4))
                : 0,
        },
    };
};

module.exports = {
    FUNNEL_STAGES,
    trackFunnelStage,
    getFunnelVisualization,
};
