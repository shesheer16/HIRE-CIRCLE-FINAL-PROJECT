const mongoose = require('mongoose');

const Application = require('../models/Application');
const Escrow = require('../models/Escrow');
const HireFeedback = require('../models/HireFeedback');
const Message = require('../models/Message');
const Referral = require('../models/Referral');
const UserTrustScore = require('../models/UserTrustScore');
const UserVerificationBadge = require('../models/UserVerificationBadge').UserVerificationBadge;
const WorkerProfile = require('../models/WorkerProfile');
const { TrustGraphNode } = require('../models/TrustGraphNode');
const { TrustGraphEdge } = require('../models/TrustGraphEdge');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);
const safeObjectId = (value) => (mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value);
const toIdString = (value) => String(value || '').trim();

const ensureNode = async ({ nodeType, externalId, ownerUserId = null, metadata = {} }) => {
    const resolvedExternalId = toIdString(externalId);
    if (!nodeType || !resolvedExternalId) {
        throw new Error('nodeType and externalId are required');
    }

    return TrustGraphNode.findOneAndUpdate(
        { nodeType, externalId: resolvedExternalId },
        {
            $setOnInsert: {
                nodeType,
                externalId: resolvedExternalId,
            },
            $set: {
                ownerUserId: ownerUserId || null,
                metadata,
            },
        },
        { upsert: true, new: true }
    );
};

const buildEdgeKey = ({ fromNodeId, toNodeId, edgeType, contextKey = '' }) => (
    `${String(fromNodeId)}:${String(toNodeId)}:${String(edgeType)}:${String(contextKey || '')}`
);

const upsertEdge = async ({
    from,
    to,
    edgeType,
    contextKey = '',
    weight = 1,
    occurredAt = new Date(),
    metadata = {},
}) => {
    const [fromNode, toNode] = await Promise.all([
        ensureNode(from),
        ensureNode(to),
    ]);

    const edgeKey = buildEdgeKey({
        fromNodeId: fromNode._id,
        toNodeId: toNode._id,
        edgeType,
        contextKey,
    });

    return TrustGraphEdge.findOneAndUpdate(
        { edgeKey },
        {
            $setOnInsert: {
                fromNode: fromNode._id,
                toNode: toNode._id,
                edgeType,
                edgeKey,
            },
            $set: {
                weight: clamp(weight, 0, 10),
                occurredAt,
                metadata,
            },
        },
        { upsert: true, new: true }
    );
};

const registerHireGraphRelations = async ({
    applicationId,
    jobId,
    employerId,
    workerUserId,
    workerProfileId = null,
    occurredAt = new Date(),
}) => {
    const appId = toIdString(applicationId);
    const jobExternal = toIdString(jobId);
    const employerExternal = toIdString(employerId);
    const workerExternal = toIdString(workerUserId);
    if (!appId || !jobExternal || !employerExternal || !workerExternal) return null;

    await Promise.all([
        ensureNode({
            nodeType: 'Hire',
            externalId: appId,
            ownerUserId: employerId,
            metadata: { applicationId: appId, workerProfileId: toIdString(workerProfileId) || null },
        }),
        ensureNode({
            nodeType: 'Job',
            externalId: jobExternal,
            ownerUserId: employerId,
            metadata: { employerId: employerExternal },
        }),
    ]);

    const [hiredByEdge, workedWithEdgeEmployerToWorker, workedWithEdgeWorkerToEmployer] = await Promise.all([
        upsertEdge({
            from: { nodeType: 'User', externalId: workerExternal, ownerUserId: workerUserId },
            to: { nodeType: 'Employer', externalId: employerExternal, ownerUserId: employerId },
            edgeType: 'hired_by',
            contextKey: appId,
            weight: 1,
            occurredAt,
            metadata: { applicationId: appId, jobId: jobExternal },
        }),
        upsertEdge({
            from: { nodeType: 'Employer', externalId: employerExternal, ownerUserId: employerId },
            to: { nodeType: 'User', externalId: workerExternal, ownerUserId: workerUserId },
            edgeType: 'worked_with',
            contextKey: appId,
            weight: 1,
            occurredAt,
            metadata: { applicationId: appId, jobId: jobExternal },
        }),
        upsertEdge({
            from: { nodeType: 'User', externalId: workerExternal, ownerUserId: workerUserId },
            to: { nodeType: 'Employer', externalId: employerExternal, ownerUserId: employerId },
            edgeType: 'worked_with',
            contextKey: `${appId}:reverse`,
            weight: 1,
            occurredAt,
            metadata: { applicationId: appId, jobId: jobExternal },
        }),
    ]);

    return {
        hiredByEdge,
        workedWithEdgeEmployerToWorker,
        workedWithEdgeWorkerToEmployer,
    };
};

const registerReferralGraphRelation = async ({
    referrerId,
    referredUserId,
    referralId,
    depth = 1,
    occurredAt = new Date(),
}) => {
    const refExternal = toIdString(referrerId);
    const referredExternal = toIdString(referredUserId);
    const referralExternal = toIdString(referralId || `${referrerId}:${referredUserId}`);
    if (!refExternal || !referredExternal) return null;

    await ensureNode({
        nodeType: 'Referral',
        externalId: referralExternal,
        ownerUserId: referrerId,
        metadata: {
            referrerId: refExternal,
            referredUserId: referredExternal,
            depth: Number(depth || 1),
        },
    });

    return upsertEdge({
        from: { nodeType: 'User', externalId: referredExternal, ownerUserId: referredUserId },
        to: { nodeType: 'User', externalId: refExternal, ownerUserId: referrerId },
        edgeType: 'referred_by',
        contextKey: referralExternal,
        weight: clamp(depth, 1, 5),
        occurredAt,
        metadata: {
            referralId: referralExternal,
            depth: Number(depth || 1),
        },
    });
};

const registerEscrowCompletionRelation = async ({
    escrowId,
    employerId,
    workerUserId,
    jobId = null,
    occurredAt = new Date(),
}) => {
    const escrowExternal = toIdString(escrowId);
    const employerExternal = toIdString(employerId);
    const workerExternal = toIdString(workerUserId);
    if (!escrowExternal || !employerExternal || !workerExternal) return null;

    await ensureNode({
        nodeType: 'EscrowCompletion',
        externalId: escrowExternal,
        ownerUserId: employerId,
        metadata: {
            employerId: employerExternal,
            workerUserId: workerExternal,
            jobId: toIdString(jobId) || null,
        },
    });

    return upsertEdge({
        from: { nodeType: 'Employer', externalId: employerExternal, ownerUserId: employerId },
        to: { nodeType: 'User', externalId: workerExternal, ownerUserId: workerUserId },
        edgeType: 'paid_successfully',
        contextKey: escrowExternal,
        weight: 1.15,
        occurredAt,
        metadata: {
            escrowId: escrowExternal,
            jobId: toIdString(jobId) || null,
        },
    });
};

const registerEndorsementRelation = async ({
    endorserUserId,
    targetUserId,
    applicationId = null,
    weight = 1,
    occurredAt = new Date(),
}) => {
    const fromExternal = toIdString(endorserUserId);
    const toExternal = toIdString(targetUserId);
    if (!fromExternal || !toExternal) return null;

    return upsertEdge({
        from: { nodeType: 'User', externalId: fromExternal, ownerUserId: endorserUserId },
        to: { nodeType: 'User', externalId: toExternal, ownerUserId: targetUserId },
        edgeType: 'endorsed_by',
        contextKey: toIdString(applicationId || `${fromExternal}:${toExternal}:${occurredAt.toISOString()}`),
        weight,
        occurredAt,
        metadata: {
            applicationId: toIdString(applicationId) || null,
        },
    });
};

const syncReleasedEscrowsToTrustGraph = async ({ limit = 200 } = {}) => {
    const rows = await Escrow.find({
        status: 'released',
        $or: [
            { 'metadata.trustGraphSynced': { $exists: false } },
            { 'metadata.trustGraphSynced': false },
        ],
    })
        .sort({ releasedAt: -1 })
        .limit(Math.max(1, Math.min(500, Number(limit || 200))))
        .lean();

    let syncedCount = 0;
    for (const row of rows) {
        await registerEscrowCompletionRelation({
            escrowId: row._id,
            employerId: row.employerId,
            workerUserId: row.workerId,
            jobId: row.jobId,
            occurredAt: row.releasedAt || row.updatedAt || row.createdAt || new Date(),
        });

        await Escrow.updateOne(
            { _id: row._id },
            {
                $set: {
                    'metadata.trustGraphSynced': true,
                    'metadata.trustGraphSyncedAt': new Date(),
                },
            }
        );

        syncedCount += 1;
    }

    return {
        scanned: rows.length,
        syncedCount,
    };
};

const computeReliabilityScore = async ({ userId, workerProfileId = null }) => {
    const [feedbackRows, workerProfile] = await Promise.all([
        HireFeedback.find({
            workerUserId: safeObjectId(userId),
            'employerFeedback.reliability': { $exists: true },
        })
            .select('employerFeedback.reliability')
            .limit(200)
            .lean(),
        workerProfileId
            ? WorkerProfile.findById(workerProfileId).select('reliabilityScore').lean()
            : WorkerProfile.findOne({ user: safeObjectId(userId) }).select('reliabilityScore').lean(),
    ]);

    const feedbackAvg = feedbackRows.length
        ? feedbackRows.reduce((sum, row) => sum + Number(row?.employerFeedback?.reliability || 0), 0) / feedbackRows.length
        : 0;

    const feedbackComponent = feedbackAvg > 0 ? clamp01(feedbackAvg / 5) : null;
    const profileComponent = clamp01(Number(workerProfile?.reliabilityScore || 0));

    if (feedbackComponent !== null) {
        return clamp01((feedbackComponent * 0.7) + (profileComponent * 0.3));
    }

    return clamp01(profileComponent || 0.6);
};

const computeHiringSuccessScore = async ({ userId, workerProfileId = null }) => {
    const [employerAggRows, workerAggRows] = await Promise.all([
        Application.aggregate([
            {
                $match: {
                    employer: safeObjectId(userId),
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    shortlisted: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0],
                        },
                    },
                    hires: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        workerProfileId
            ? Application.aggregate([
                { $match: { worker: safeObjectId(workerProfileId) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        hires: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                            },
                        },
                    },
                },
            ])
            : Promise.resolve([]),
    ]);

    const employerAgg = employerAggRows[0] || { total: 0, shortlisted: 0, hires: 0 };
    const workerAgg = workerAggRows[0] || { total: 0, hires: 0 };

    const employerScore = clamp01(
        (safeDiv(employerAgg.hires, Math.max(employerAgg.shortlisted, 1)) * 0.65)
        + (safeDiv(employerAgg.hires, Math.max(employerAgg.total, 1)) * 0.35)
    );
    const workerScore = clamp01(safeDiv(workerAgg.hires, Math.max(workerAgg.total, 1)));

    return clamp01(Math.max(employerScore, workerScore));
};

const computeResponseScore = async ({ userId, workerProfileId = null }) => {
    const filter = {
        $or: [
            { employer: safeObjectId(userId) },
            ...(workerProfileId ? [{ worker: safeObjectId(workerProfileId) }] : []),
        ],
    };

    const [appRows, sentMessages] = await Promise.all([
        Application.aggregate([
            { $match: filter },
            {
                $project: {
                    responseMs: { $subtract: ['$updatedAt', '$createdAt'] },
                },
            },
            {
                $group: {
                    _id: null,
                    avgResponseMs: { $avg: '$responseMs' },
                },
            },
        ]),
        Message.countDocuments({ sender: safeObjectId(userId) }),
    ]);

    const avgResponseMs = Number(appRows[0]?.avgResponseMs || 0);
    const avgHours = avgResponseMs > 0 ? (avgResponseMs / (1000 * 60 * 60)) : 72;
    const appResponseScore = clamp01(1 - (avgHours / 72));
    const messageActivityScore = clamp01(Math.log10(Math.max(1, sentMessages + 1)) / 2);

    return clamp01((appResponseScore * 0.8) + (messageActivityScore * 0.2));
};

const computeCompletionScore = async ({ userId, workerProfileId = null }) => {
    const [applicationRows, escrowRows] = await Promise.all([
        Application.aggregate([
            {
                $match: {
                    $or: [
                        { employer: safeObjectId(userId) },
                        ...(workerProfileId ? [{ worker: safeObjectId(workerProfileId) }] : []),
                    ],
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    completed: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        Escrow.aggregate([
            {
                $match: {
                    $or: [
                        { employerId: safeObjectId(userId) },
                        { workerId: safeObjectId(userId) },
                    ],
                },
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const appAgg = applicationRows[0] || { total: 0, completed: 0 };
    const escrowTotal = escrowRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const escrowReleased = Number((escrowRows.find((row) => row._id === 'released') || {}).count || 0);

    const applicationCompletion = clamp01(safeDiv(appAgg.completed, Math.max(appAgg.total, 1)));
    const escrowCompletion = clamp01(safeDiv(escrowReleased, Math.max(escrowTotal, 1)));

    return clamp01((applicationCompletion * 0.7) + (escrowCompletion * 0.3));
};

const computeReferralScore = async ({ userId }) => {
    const [referralAggRows, graphEdgeCount] = await Promise.all([
        Referral.aggregate([
            {
                $match: {
                    $or: [
                        { referrerId: safeObjectId(userId) },
                        { referrer: safeObjectId(userId) },
                    ],
                },
            },
            {
                $group: {
                    _id: null,
                    completedCount: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'completed'] }, 1, 0],
                        },
                    },
                    avgDepth: { $avg: { $ifNull: ['$depth', 1] } },
                },
            },
        ]),
        (async () => {
            const userNode = await TrustGraphNode.findOne({
                nodeType: 'User',
                externalId: toIdString(userId),
            })
                .select('_id')
                .lean();

            if (!userNode?._id) return 0;
            return TrustGraphEdge.countDocuments({
                toNode: userNode._id,
                edgeType: 'referred_by',
            });
        })(),
    ]);

    const agg = referralAggRows[0] || { completedCount: 0, avgDepth: 1 };
    const completedScore = clamp01(Number(agg.completedCount || 0) / 6);
    const depthScore = clamp01(Number(agg.avgDepth || 1) / 4);
    const graphDensityScore = clamp01(Number(graphEdgeCount || 0) / 8);

    return clamp01((completedScore * 0.55) + (depthScore * 0.25) + (graphDensityScore * 0.20));
};

const recomputeTrustGraphForUser = async ({ userId, reason = 'manual' }) => {
    if (!userId) return null;

    const workerProfile = await WorkerProfile.findOne({ user: safeObjectId(userId) })
        .select('_id')
        .lean();
    const workerProfileId = workerProfile?._id || null;

    const [
        reliabilityScore,
        hiringSuccessScore,
        responseScore,
        completionScore,
        referralScore,
        badge,
    ] = await Promise.all([
        computeReliabilityScore({ userId, workerProfileId }),
        computeHiringSuccessScore({ userId, workerProfileId }),
        computeResponseScore({ userId, workerProfileId }),
        computeCompletionScore({ userId, workerProfileId }),
        computeReferralScore({ userId }),
        UserVerificationBadge.findOne({ userId: safeObjectId(userId) })
            .select('trustBoostPoints tier rankingBoostMultiplier visibilityBoostMultiplier')
            .lean(),
    ]);

    const trustGraphScoreRaw = clamp01(
        (reliabilityScore * 0.30)
        + (hiringSuccessScore * 0.22)
        + (responseScore * 0.16)
        + (completionScore * 0.22)
        + (referralScore * 0.10)
    );

    const badgeTrustBoostPoints = Number(badge?.trustBoostPoints || 0);
    const badgeTrustBoostNormalized = clamp01(badgeTrustBoostPoints / 100);
    const trustGraphScore = clamp01(trustGraphScoreRaw + badgeTrustBoostNormalized);

    const payload = {
        reliabilityScore: Number(reliabilityScore.toFixed(4)),
        hiringSuccessScore: Number(hiringSuccessScore.toFixed(4)),
        responseScore: Number(responseScore.toFixed(4)),
        completionScore: Number(completionScore.toFixed(4)),
        referralScore: Number(referralScore.toFixed(4)),
        trustGraphScore: Number((trustGraphScore * 100).toFixed(2)),
        rankingMultiplier: Number(clamp(Number(badge?.rankingBoostMultiplier || 1), 1, 1.25).toFixed(3)),
        visibilityMultiplier: Number(clamp(Number(badge?.visibilityBoostMultiplier || 1), 1, 1.5).toFixed(3)),
        badgeTier: badge?.tier || 'Basic',
    };

    await UserTrustScore.findOneAndUpdate(
        { userId: safeObjectId(userId) },
        {
            $set: {
                ...payload,
                metadata: {
                    reason,
                    source: 'trust_graph_engine',
                    computedAt: new Date().toISOString(),
                },
                lastEvaluatedAt: new Date(),
            },
        },
        { upsert: true, new: true }
    );

    return payload;
};

const getTrustBreakdownForUser = async ({ userId, recomputeIfMissing = true }) => {
    if (!userId) return null;

    let row = await UserTrustScore.findOne({ userId: safeObjectId(userId) })
        .select('reliabilityScore hiringSuccessScore responseScore completionScore referralScore trustGraphScore rankingMultiplier visibilityMultiplier badgeTier score status')
        .lean();

    if (!row && recomputeIfMissing) {
        await recomputeTrustGraphForUser({ userId, reason: 'on_demand_breakdown' });
        row = await UserTrustScore.findOne({ userId: safeObjectId(userId) })
            .select('reliabilityScore hiringSuccessScore responseScore completionScore referralScore trustGraphScore rankingMultiplier visibilityMultiplier badgeTier score status')
            .lean();
    }

    if (!row) return null;

    return {
        reliabilityScore: Number(row.reliabilityScore || 0),
        hiringSuccessScore: Number(row.hiringSuccessScore || 0),
        responseScore: Number(row.responseScore || 0),
        completionScore: Number(row.completionScore || 0),
        referralScore: Number(row.referralScore || 0),
        trustGraphScore: Number(row.trustGraphScore || 0),
        trustStatus: row.status || 'healthy',
        abuseTrustScore: Number(row.score || 100),
        rankingMultiplier: Number(row.rankingMultiplier || 1),
        visibilityMultiplier: Number(row.visibilityMultiplier || 1),
        badgeTier: row.badgeTier || 'Basic',
    };
};

const EDGE_TYPE_COMPAT_MAP = Object.freeze({
    hired_by: 'hired',
    hired: 'hired',
    paid_successfully: 'hired',
    referred_by: 'referred',
    referred: 'referred',
    worked_with: 'collaborated',
    collaborated: 'collaborated',
    endorsed_by: 'endorsed',
    endorsed: 'endorsed',
    messaged: 'messaged',
    community_interaction: 'community_interaction',
});

const EDGE_TYPE_WEIGHT_MAP = Object.freeze({
    hired: 1,
    collaborated: 0.8,
    endorsed: 0.65,
    referred: 0.6,
    community_interaction: 0.4,
    messaged: 0.25,
});

const resolveEdgeType = (edgeType) => {
    const normalized = String(edgeType || '').trim().toLowerCase();
    return EDGE_TYPE_COMPAT_MAP[normalized] || 'collaborated';
};

const recordTrustEdge = async ({
    fromUserId,
    toUserId,
    edgeType,
    weight = 50,
    qualityScore = 0,
    negative = false,
    referenceType = '',
    referenceId = '',
    metadata = {},
    occurredAt = new Date(),
}) => {
    const from = toIdString(fromUserId);
    const to = toIdString(toUserId);
    if (!from || !to || from === to) return null;

    const normalizedEdgeType = resolveEdgeType(edgeType);
    const contextKey = String(referenceId || `${referenceType || normalizedEdgeType}:${from}:${to}`).trim();
    return upsertEdge({
        from: {
            nodeType: 'User',
            externalId: from,
            ownerUserId: fromUserId,
        },
        to: {
            nodeType: 'User',
            externalId: to,
            ownerUserId: toUserId,
        },
        edgeType: normalizedEdgeType,
        contextKey,
        weight: clamp(Number(weight || 0) / 10, 0, 10),
        occurredAt: occurredAt instanceof Date ? occurredAt : new Date(occurredAt),
        metadata: {
            ...(metadata && typeof metadata === 'object' ? metadata : {}),
            fromUserId: from,
            toUserId: to,
            qualityScore: clamp(qualityScore, -100, 100),
            negative: Boolean(negative),
            referenceType: String(referenceType || '').trim(),
            referenceId: String(referenceId || '').trim(),
        },
    });
};

const getUserTrustEdges = async ({ userId, sinceDays = 365 }) => {
    if (!userId) return [];
    const userIdText = toIdString(userId);
    const relatedNodes = await TrustGraphNode.find({
        externalId: userIdText,
    })
        .select('_id externalId')
        .lean();
    if (!relatedNodes.length) return [];

    const nodeIds = relatedNodes.map((node) => node._id);
    const since = new Date(Date.now() - (Math.max(1, Number(sinceDays) || 365) * 24 * 60 * 60 * 1000));
    const edges = await TrustGraphEdge.find({
        $or: [{ fromNode: { $in: nodeIds } }, { toNode: { $in: nodeIds } }],
        occurredAt: { $gte: since },
    })
        .populate('fromNode', 'externalId nodeType')
        .populate('toNode', 'externalId nodeType')
        .lean();

    return edges.map((edge) => ({
        fromUserId: toIdString(edge?.fromNode?.externalId || edge?.metadata?.fromUserId || ''),
        toUserId: toIdString(edge?.toNode?.externalId || edge?.metadata?.toUserId || ''),
        edgeType: resolveEdgeType(edge.edgeType),
        weight: clamp(Number(edge.weight || 0) * 10, 0, 100),
        qualityScore: clamp(Number(edge?.metadata?.qualityScore || 0), -100, 100),
        negative: Boolean(edge?.metadata?.negative),
        occurredAt: edge.occurredAt,
        metadata: edge.metadata || {},
    }));
};

const calculateNetworkAuthorityScore = async ({ userId, edges = null }) => {
    if (!userId) {
        return {
            score: 0,
            bounded: true,
            edgeCount: 0,
            positiveDelta: 0,
            negativeDelta: 0,
            contributions: [],
        };
    }

    const edgeRows = Array.isArray(edges) ? edges : await getUserTrustEdges({ userId, sinceDays: 365 });
    if (!edgeRows.length) {
        return {
            score: 50,
            bounded: true,
            edgeCount: 0,
            positiveDelta: 0,
            negativeDelta: 0,
            contributions: [],
        };
    }

    const userIdText = toIdString(userId);
    const counterpartIds = Array.from(new Set(
        edgeRows.map((edge) => {
            const from = toIdString(edge.fromUserId);
            const to = toIdString(edge.toUserId);
            return from === userIdText ? to : from;
        }).filter(Boolean)
    ));

    const trustRows = await UserTrustScore.find({
        userId: { $in: counterpartIds.map((id) => safeObjectId(id)) },
    })
        .select('userId score trustGraphScore')
        .lean();
    const trustMap = new Map(trustRows.map((row) => [
        toIdString(row.userId),
        clamp(Number(row.trustGraphScore || row.score || 50), 0, 100),
    ]));

    let positiveDelta = 0;
    let negativeDelta = 0;
    const contributions = [];

    for (const edge of edgeRows) {
        const from = toIdString(edge.fromUserId);
        const to = toIdString(edge.toUserId);
        const counterpartId = from === userIdText ? to : from;
        const counterpartTrust = trustMap.has(counterpartId) ? trustMap.get(counterpartId) : 50;
        const trustSignal = (counterpartTrust - 50) / 50;
        const typeWeight = EDGE_TYPE_WEIGHT_MAP[resolveEdgeType(edge.edgeType)] || 0.2;
        const edgeWeight = clamp(Number(edge.weight || 0), 0, 100) / 100;
        const quality = clamp(Number(edge.qualityScore || 0), -100, 100) / 100;
        let delta = ((trustSignal * 8) + (quality * 2)) * typeWeight * edgeWeight;
        if (edge.negative) delta *= -1.15;
        delta = clamp(delta, -8, 8);

        if (delta >= 0) positiveDelta += delta;
        else negativeDelta += Math.abs(delta);

        contributions.push({
            counterpartId,
            edgeType: resolveEdgeType(edge.edgeType),
            counterpartTrust,
            delta: Number(delta.toFixed(3)),
            negative: Boolean(edge.negative),
        });
    }

    const score = clamp(50 + (positiveDelta - negativeDelta), 0, 100);
    return {
        score: Number(score.toFixed(2)),
        bounded: score >= 0 && score <= 100,
        edgeCount: edgeRows.length,
        positiveDelta: Number(positiveDelta.toFixed(3)),
        negativeDelta: Number(negativeDelta.toFixed(3)),
        contributions,
    };
};

module.exports = {
    ensureNode,
    upsertEdge,
    registerHireGraphRelations,
    registerReferralGraphRelation,
    registerEscrowCompletionRelation,
    registerEndorsementRelation,
    syncReleasedEscrowsToTrustGraph,
    recordTrustEdge,
    getUserTrustEdges,
    calculateNetworkAuthorityScore,
    recomputeTrustGraphForUser,
    getTrustBreakdownForUser,
};
