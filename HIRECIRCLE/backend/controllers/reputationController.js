const NetworkRiskFlag = require('../models/NetworkRiskFlag');
const {
    getProfileAuthoritySnapshot,
    recalculateReputationProfile,
    getReputationProfile,
    buildTrustScoreExplanation,
} = require('../services/reputationEngineService');
const { syncUserBadges } = require('../services/reputationBadgeService');
const {
    createEndorsement,
    getUserEndorsements,
} = require('../services/endorsementService');
const {
    submitHireRating,
    listHireRecordsForUser,
    ensureHireRecordFromApplication,
    toViewerSafeHireRecord,
} = require('../services/hireRecordService');
const { scanNetworkRisks } = require('../services/networkRiskService');
const { computeCommunityTrustScore } = require('../services/communityTrustService');

const asId = (value) => String(value || '').trim();

const getMyReputation = async (req, res) => {
    try {
        const recompute = String(req.query.recompute || '').toLowerCase() === 'true';
        const summary = await getProfileAuthoritySnapshot({
            userId: req.user._id,
            recompute,
        });
        return res.json({ reputation: summary });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load reputation' });
    }
};

const getUserReputation = async (req, res) => {
    try {
        const userId = req.params.userId;
        const profile = await getReputationProfile({ userId, recompute: false });
        if (!profile) return res.status(404).json({ message: 'Reputation profile not found' });

        return res.json({
            reputation: {
                userId: asId(profile.userId),
                trustScore: profile.overallTrustScore,
                completionRate: profile.completionRate,
                endorsements: profile.endorsementsCount,
                verifiedHires: profile.verifiedHires,
                authorityRank: profile.authorityRank,
                communityInfluence: profile.communityInfluence,
                networkAuthorityScore: profile.networkAuthorityScore,
                responseScore: profile.responseScore,
                hireSuccessScore: profile.hireSuccessScore,
                updatedAt: profile.updatedAt,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load user reputation' });
    }
};

const getMyTrustExplanation = async (req, res) => {
    try {
        const profile = await getReputationProfile({
            userId: req.user._id,
            recompute: String(req.query.recompute || '').toLowerCase() === 'true',
        });
        if (!profile) return res.status(404).json({ message: 'Reputation profile not found' });
        return res.json({ explanation: buildTrustScoreExplanation(profile) });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to build trust explanation' });
    }
};

const endorse = async (req, res) => {
    try {
        const { toUserId, skill } = req.body || {};
        const endorsement = await createEndorsement({
            fromUserId: req.user._id,
            toUserId,
            skill,
            verified: false,
        });
        return res.status(201).json({ endorsement });
    } catch (error) {
        const code = String(error.code || '');
        if (
            code === 'SELF_ENDORSEMENT_FORBIDDEN'
            || code === 'CIRCULAR_ENDORSEMENT_BLOCKED'
            || code === 'ENDORSEMENT_THROTTLED'
            || code === 'ENDORSEMENT_ALREADY_EXISTS'
            || code === 'INVALID_SKILL'
        ) {
            return res.status(400).json({
                message: error.message,
                code,
                details: error.details || null,
            });
        }
        return res.status(500).json({ message: 'Failed to create endorsement' });
    }
};

const getEndorsements = async (req, res) => {
    try {
        const userId = req.params.userId || req.user._id;
        const endorsements = await getUserEndorsements({
            userId,
            limit: req.query.limit || 50,
        });
        return res.json({ endorsements });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load endorsements' });
    }
};

const getMyHireHistory = async (req, res) => {
    try {
        const records = await listHireRecordsForUser({
            userId: req.user._id,
            viewerId: req.user._id,
            limit: req.query.limit || 50,
        });
        return res.json({ hireRecords: records });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load hire history' });
    }
};

const rateHireRecord = async (req, res) => {
    try {
        const { rating } = req.body || {};
        const record = await submitHireRating({
            hireRecordId: req.params.hireRecordId,
            userId: req.user._id,
            rating,
        });
        return res.json({
            hireRecord: toViewerSafeHireRecord({
                hireRecord: record,
                viewerId: req.user._id,
            }),
        });
    } catch (error) {
        const code = String(error.code || '');
        if (['HIRE_RECORD_NOT_FOUND', 'HIRE_RECORD_FORBIDDEN'].includes(code)) {
            return res.status(404).json({ message: error.message, code });
        }
        if (code === 'RATING_IMMUTABLE') {
            return res.status(409).json({ message: error.message, code });
        }
        return res.status(500).json({ message: 'Failed to submit hire rating' });
    }
};

const adminRecomputeReputation = async (req, res) => {
    try {
        const profile = await recalculateReputationProfile({
            userId: req.params.userId,
            reason: 'admin_recompute',
        });
        if (!profile) return res.status(404).json({ message: 'User not found' });
        return res.json({ profile });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to recompute reputation' });
    }
};

const adminSyncHireRecordFromApplication = async (req, res) => {
    try {
        const hireRecord = await ensureHireRecordFromApplication({
            applicationId: req.params.applicationId,
            success: true,
        });
        if (!hireRecord) {
            return res.status(404).json({ message: 'Could not create hire record from application' });
        }
        return res.json({ hireRecord });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to sync hire record' });
    }
};

const adminScanNetworkRisks = async (req, res) => {
    try {
        const summary = await scanNetworkRisks({
            sinceDays: req.query.sinceDays || 120,
        });
        return res.json({ summary });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to scan network risks' });
    }
};

const adminListNetworkRiskFlags = async (req, res) => {
    try {
        const status = String(req.query.status || 'open').trim().toLowerCase();
        const query = status === 'all'
            ? {}
            : { status: { $in: status.split(',').map((item) => item.trim()).filter(Boolean) } };

        const flags = await NetworkRiskFlag.find(query)
            .sort({ severity: -1, createdAt: -1 })
            .limit(Math.max(1, Math.min(300, Number(req.query.limit) || 100)))
            .lean();
        return res.json({ flags });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load network risk flags' });
    }
};

const adminComputeCommunityTrust = async (req, res) => {
    try {
        const score = await computeCommunityTrustScore({
            circleId: req.params.circleId,
            upsert: true,
        });
        if (!score) return res.status(404).json({ message: 'Community not found' });
        return res.json({ score });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to compute community trust' });
    }
};

const adminOverrideUserBadges = async (req, res) => {
    try {
        const userId = req.params.userId;
        const profile = await getReputationProfile({ userId, recompute: true });
        if (!profile) return res.status(404).json({ message: 'Reputation profile not found' });

        const badgeKeys = Array.isArray(req.body?.badgeKeys) ? req.body.badgeKeys : [];
        const badges = await syncUserBadges({
            userId,
            reputationProfile: profile,
            adminOverrideBadgeKeys: badgeKeys,
        });
        return res.json({ badges });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to override badges' });
    }
};

module.exports = {
    getMyReputation,
    getUserReputation,
    getMyTrustExplanation,
    endorse,
    getEndorsements,
    getMyHireHistory,
    rateHireRecord,
    adminRecomputeReputation,
    adminSyncHireRecordFromApplication,
    adminScanNetworkRisks,
    adminListNetworkRiskFlags,
    adminComputeCommunityTrust,
    adminOverrideUserBadges,
};
