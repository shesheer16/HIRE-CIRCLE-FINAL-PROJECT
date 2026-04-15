const Endorsement = require('../models/Endorsement');
const Referral = require('../models/Referral');
const { TrustGraphEdge } = require('../models/TrustGraphEdge');
const User = require('../models/userModel');
const NetworkRiskFlag = require('../models/NetworkRiskFlag');

const clamp = (value, min = 0, max = 100) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const asId = (value) => String(value || '').trim();
const canonicalUsers = (users = []) => Array.from(new Set(users.map((item) => asId(item)).filter(Boolean))).sort();
const usersKey = (users = []) => canonicalUsers(users).join(':');
const dayBucket = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const upsertRiskFlag = async ({
    flagType,
    users = [],
    severity,
    signalScore,
    summary,
    details = {},
}) => {
    const normalizedUsers = canonicalUsers(users);
    if (!normalizedUsers.length) return null;

    const signature = `${flagType}:${usersKey(normalizedUsers)}:${dayBucket(new Date())}`;
    const existing = await NetworkRiskFlag.findOne({
        flagType,
        status: { $in: ['open', 'reviewing'] },
        'details.signature': signature,
    }).lean();
    if (existing) return existing;

    return NetworkRiskFlag.create({
        flagType,
        users: normalizedUsers,
        severity: clamp(severity, 0, 100),
        signalScore: clamp(signalScore, 0, 100),
        status: 'open',
        summary: String(summary || '').trim(),
        details: {
            ...details,
            signature,
        },
    });
};

const detectFakeReviewRings = (endorsements = []) => {
    const directionMap = new Map();
    for (const endorsement of endorsements) {
        const from = asId(endorsement.fromUserId);
        const to = asId(endorsement.toUserId);
        if (!from || !to || from === to) continue;
        const key = `${from}->${to}`;
        directionMap.set(key, (directionMap.get(key) || 0) + 1);
    }

    const rings = [];
    const checked = new Set();
    for (const [key, count] of directionMap.entries()) {
        const [from, to] = key.split('->');
        const pairKey = [from, to].sort().join(':');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        const reverse = `${to}->${from}`;
        const reverseCount = directionMap.get(reverse) || 0;
        if (count >= 2 && reverseCount >= 2) {
            rings.push({
                users: [from, to],
                count,
                reverseCount,
            });
        }
    }

    return rings;
};

const detectEndorsementClusters = (endorsements = []) => {
    const grouped = new Map();
    for (const endorsement of endorsements) {
        const to = asId(endorsement.toUserId);
        if (!to) continue;
        const bucket = dayBucket(endorsement.createdAt);
        const key = `${to}:${bucket}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(endorsement);
    }

    const clusters = [];
    for (const [key, rows] of grouped.entries()) {
        const uniqueFrom = new Set(rows.map((row) => asId(row.fromUserId)).filter(Boolean));
        if (rows.length >= 6 && uniqueFrom.size >= 4) {
            const [toUserId, day] = key.split(':');
            clusters.push({
                toUserId,
                day,
                total: rows.length,
                uniqueEndorsers: uniqueFrom.size,
                endorsers: Array.from(uniqueFrom),
            });
        }
    }
    return clusters;
};

const findTriangles = (edges = []) => {
    const adjacency = new Map();
    for (const edge of edges) {
        const from = asId(edge.fromUserId);
        const to = asId(edge.toUserId);
        if (!from || !to || from === to) continue;
        if (!adjacency.has(from)) adjacency.set(from, new Set());
        adjacency.get(from).add(to);
    }

    const triangles = new Map();
    for (const [a, aNeighbors] of adjacency.entries()) {
        for (const b of aNeighbors) {
            const bNeighbors = adjacency.get(b);
            if (!bNeighbors) continue;
            for (const c of bNeighbors) {
                const cNeighbors = adjacency.get(c);
                if (!cNeighbors || !cNeighbors.has(a)) continue;
                const key = [a, b, c].sort().join(':');
                if (!triangles.has(key)) {
                    triangles.set(key, [a, b, c]);
                }
            }
        }
    }

    return Array.from(triangles.values());
};

const detectReferralManipulation = (users = []) => {
    const referredByMap = new Map();
    for (const user of users) {
        const userId = asId(user._id);
        const referredBy = asId(user.referredBy);
        if (!userId || !referredBy || userId === referredBy) continue;
        referredByMap.set(userId, referredBy);
    }

    const loops = [];
    for (const [userId, parentId] of referredByMap.entries()) {
        const reverseParent = referredByMap.get(parentId);
        if (reverseParent && reverseParent === userId) {
            loops.push([userId, parentId]);
        }
    }
    return loops;
};

const scanNetworkRisks = async ({ sinceDays = 120 } = {}) => {
    const since = new Date(Date.now() - (Math.max(1, Number(sinceDays) || 120) * 24 * 60 * 60 * 1000));
    const [endorsements, referrals, trustEdges, users] = await Promise.all([
        Endorsement.find({ createdAt: { $gte: since }, status: 'active' })
            .select('fromUserId toUserId weight createdAt')
            .lean(),
        Referral.find({ createdAt: { $gte: since } })
            .select('referrer referrerId referredUserId status createdAt')
            .lean(),
        TrustGraphEdge.find({ occurredAt: { $gte: since } })
            .select('fromNode toNode edgeType metadata occurredAt')
            .populate('fromNode', 'externalId')
            .populate('toNode', 'externalId')
            .lean(),
        User.find({ referredBy: { $ne: null } })
            .select('_id referredBy')
            .lean(),
    ]);

    const createdFlags = [];

    const fakeRings = detectFakeReviewRings(endorsements);
    for (const ring of fakeRings) {
        const severity = clamp((ring.count + ring.reverseCount) * 12, 40, 95);
        const flag = await upsertRiskFlag({
            flagType: 'fake_review_ring',
            users: ring.users,
            severity,
            signalScore: severity,
            summary: 'Mutual endorsement ring pattern detected.',
            details: ring,
        });
        if (flag) createdFlags.push(flag);
    }

    const clusters = detectEndorsementClusters(endorsements);
    for (const cluster of clusters) {
        const severity = clamp((cluster.total * 7) + (cluster.uniqueEndorsers * 3), 45, 98);
        const flag = await upsertRiskFlag({
            flagType: 'endorsement_cluster',
            users: [cluster.toUserId, ...cluster.endorsers],
            severity,
            signalScore: severity,
            summary: 'Dense endorsement cluster detected within a short time window.',
            details: cluster,
        });
        if (flag) createdFlags.push(flag);
    }

    const coordinatedBoostTriangles = findTriangles(
        endorsements.map((endorsement) => ({
            fromUserId: endorsement.fromUserId,
            toUserId: endorsement.toUserId,
        }))
    );
    for (const triangle of coordinatedBoostTriangles) {
        const flag = await upsertRiskFlag({
            flagType: 'coordinated_boosting',
            users: triangle,
            severity: 78,
            signalScore: 80,
            summary: 'Triangular endorsement boosting pattern detected.',
            details: { triangleUsers: triangle },
        });
        if (flag) createdFlags.push(flag);
    }

    const referralLoops = detectReferralManipulation(users);
    for (const loopUsers of referralLoops) {
        const flag = await upsertRiskFlag({
            flagType: 'referral_manipulation',
            users: loopUsers,
            severity: 72,
            signalScore: 76,
            summary: 'Referral loop detected between accounts.',
            details: {
                loopUsers,
                referralsConsidered: referrals.length,
            },
        });
        if (flag) createdFlags.push(flag);
    }

    const trustLoopTriangles = findTriangles(
        trustEdges
            .filter((edge) => ['endorsed', 'referred', 'collaborated', 'endorsed_by', 'referred_by', 'worked_with'].includes(String(edge.edgeType || '')))
            .map((edge) => ({
                fromUserId: edge?.fromNode?.externalId || edge?.metadata?.fromUserId || null,
                toUserId: edge?.toNode?.externalId || edge?.metadata?.toUserId || null,
            }))
    );
    for (const loop of trustLoopTriangles) {
        const flag = await upsertRiskFlag({
            flagType: 'suspicious_trust_loop',
            users: loop,
            severity: 70,
            signalScore: 74,
            summary: 'Suspicious trust loop detected in graph edges.',
            details: { loopUsers: loop },
        });
        if (flag) createdFlags.push(flag);
    }

    return {
        generated: createdFlags.length,
        fakeReviewRings: fakeRings.length,
        endorsementClusters: clusters.length,
        coordinatedBoosting: coordinatedBoostTriangles.length,
        referralManipulation: referralLoops.length,
        suspiciousTrustLoops: trustLoopTriangles.length,
        flags: createdFlags,
    };
};

module.exports = {
    scanNetworkRisks,
};
