const Endorsement = require('../models/Endorsement');
const ReputationProfile = require('../models/ReputationProfile');
const { recordTrustEdge } = require('./trustGraphService');

const ENDORSEMENT_THROTTLE_LIMIT = Number.parseInt(process.env.ENDORSEMENT_THROTTLE_LIMIT || '20', 10);
const ENDORSEMENT_THROTTLE_HOURS = Number.parseInt(process.env.ENDORSEMENT_THROTTLE_HOURS || '24', 10);

const clamp = (value, min = 0, max = 100) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const asId = (value) => String(value || '').trim();

const computeEndorsementWeight = ({ endorserTrustScore, verified = false }) => {
    const trust = clamp(endorserTrustScore, 0, 100);
    const weight = (trust * 0.7) + (verified ? 15 : 5);
    return Number(clamp(weight, 5, 100).toFixed(2));
};

const ensureNotSpamBurst = async ({ fromUserId }) => {
    const since = new Date(Date.now() - (Math.max(1, ENDORSEMENT_THROTTLE_HOURS) * 60 * 60 * 1000));
    const count = await Endorsement.countDocuments({
        fromUserId,
        createdAt: { $gte: since },
        status: 'active',
    });
    if (count >= Math.max(1, ENDORSEMENT_THROTTLE_LIMIT)) {
        const error = new Error('Endorsement rate limit exceeded');
        error.code = 'ENDORSEMENT_THROTTLED';
        throw error;
    }
};

const detectCircularEndorsement = async ({ fromUserId, toUserId }) => {
    const directMutual = await Endorsement.exists({
        fromUserId: toUserId,
        toUserId: fromUserId,
        status: 'active',
    });
    if (directMutual) return { circular: true, reason: 'direct_mutual_endorsement' };

    const toOutgoing = await Endorsement.find({
        fromUserId: toUserId,
        status: 'active',
    })
        .select('toUserId')
        .limit(30)
        .lean();
    const intermediateIds = Array.from(new Set(toOutgoing.map((row) => asId(row.toUserId)).filter(Boolean)));
    if (!intermediateIds.length) return { circular: false, reason: null };

    const threeNodeCycle = await Endorsement.exists({
        fromUserId: { $in: intermediateIds },
        toUserId: fromUserId,
        status: 'active',
    });
    if (threeNodeCycle) return { circular: true, reason: 'three_node_cycle' };

    return { circular: false, reason: null };
};

const createEndorsement = async ({
    fromUserId,
    toUserId,
    skill,
    verified = false,
}) => {
    const normalizedSkill = String(skill || '').trim().toLowerCase();
    if (!normalizedSkill) {
        const error = new Error('Skill is required');
        error.code = 'INVALID_SKILL';
        throw error;
    }

    if (!fromUserId || !toUserId || asId(fromUserId) === asId(toUserId)) {
        const error = new Error('Self endorsement is not allowed');
        error.code = 'SELF_ENDORSEMENT_FORBIDDEN';
        throw error;
    }

    await ensureNotSpamBurst({ fromUserId });

    const circularCheck = await detectCircularEndorsement({ fromUserId, toUserId });
    if (circularCheck.circular) {
        const error = new Error('Circular endorsement detected');
        error.code = 'CIRCULAR_ENDORSEMENT_BLOCKED';
        error.details = circularCheck;
        throw error;
    }

    const alreadyExists = await Endorsement.exists({
        fromUserId,
        toUserId,
        skill: normalizedSkill,
    });
    if (alreadyExists) {
        const error = new Error('Endorsement already exists for this skill');
        error.code = 'ENDORSEMENT_ALREADY_EXISTS';
        throw error;
    }

    const endorserReputation = await ReputationProfile.findOne({ userId: fromUserId })
        .select('overallTrustScore')
        .lean();
    const weight = computeEndorsementWeight({
        endorserTrustScore: Number(endorserReputation?.overallTrustScore || 50),
        verified,
    });

    const endorsement = await Endorsement.create({
        fromUserId,
        toUserId,
        skill: normalizedSkill,
        weight,
        verified: Boolean(verified),
        status: 'active',
    });

    await recordTrustEdge({
        fromUserId,
        toUserId,
        edgeType: 'endorsed',
        weight,
        qualityScore: verified ? 18 : 8,
        negative: false,
        referenceType: 'endorsement',
        referenceId: String(endorsement._id),
        metadata: {
            skill: normalizedSkill,
            verified: Boolean(verified),
        },
    });

    try {
        const { recalculateReputationProfile } = require('./reputationEngineService');
        const { scanNetworkRisks } = require('./networkRiskService');
        await recalculateReputationProfile({ userId: toUserId, reason: 'endorsement_received' });
        await scanNetworkRisks({ sinceDays: 120 });
    } catch (_error) {
        // Non-blocking reputation refresh.
    }

    return endorsement;
};

const getUserEndorsements = async ({ userId, limit = 50 }) => {
    if (!userId) return [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    return Endorsement.find({
        toUserId: userId,
        status: 'active',
    })
        .sort({ createdAt: -1 })
        .limit(safeLimit)
        .lean();
};

const getUserEndorsementStats = async ({ userId }) => {
    if (!userId) {
        return {
            count: 0,
            weightedScore: 0,
            verifiedCount: 0,
            uniqueSkills: 0,
        };
    }

    const rows = await Endorsement.find({
        toUserId: userId,
        status: 'active',
    })
        .select('weight verified skill')
        .lean();

    if (!rows.length) {
        return {
            count: 0,
            weightedScore: 0,
            verifiedCount: 0,
            uniqueSkills: 0,
        };
    }

    const totalWeight = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
    const verifiedCount = rows.filter((row) => row.verified).length;
    const uniqueSkills = new Set(rows.map((row) => String(row.skill || '').trim()).filter(Boolean)).size;

    return {
        count: rows.length,
        weightedScore: Number(clamp(totalWeight / rows.length, 0, 100).toFixed(2)),
        verifiedCount,
        uniqueSkills,
    };
};

module.exports = {
    ENDORSEMENT_THROTTLE_LIMIT,
    ENDORSEMENT_THROTTLE_HOURS,
    computeEndorsementWeight,
    createEndorsement,
    getUserEndorsements,
    getUserEndorsementStats,
    detectCircularEndorsement,
};
