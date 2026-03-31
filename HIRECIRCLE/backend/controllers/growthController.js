const mongoose = require('mongoose');
const User = require('../models/userModel');
const Job = require('../models/Job');
const Bounty = require('../models/Bounty');
const Circle = require('../models/Circle');
const Post = require('../models/Post');
const Referral = require('../models/Referral');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const UserNetworkScore = require('../models/UserNetworkScore');
const { sanitizeText } = require('../utils/sanitizeText');
const logger = require('../utils/logger');

const {
    ensureUserReferralCode,
    getReferralDashboard,
} = require('../services/referralService');
const {
    buildJobShareLink,
    buildProfileShareLink,
    buildCommunityShareLink,
    buildBountyShareLink,
    buildReferralInviteLink,
    extractObjectIdFromSeoSlug,
    buildSeoMetadata,
    getWebBaseUrl,
} = require('../services/growthLinkService');
const { assignUserToExperiment, getOrCreateExperiment } = require('../services/experimentService');
const { getLatestGrowthMetrics, upsertGrowthMetricsForDay } = require('../services/growthMetricsService');
const { getMonetizationIntelligence } = require('../services/monetizationIntelligenceService');
const { getConversionNudges } = require('../services/growthConversionService');
const { recomputeUserNetworkScore } = require('../services/networkScoreService');
const { getFunnelVisualization } = require('../services/growthFunnelService');

const toObjectIdOrNull = (value) => extractObjectIdFromSeoSlug(value);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());
const resolveMaybeQuery = async (result) => {
    if (!result) return result;
    if (typeof result.lean === 'function') {
        return result.lean();
    }
    return result;
};
const selectMaybe = (result, projection) => {
    if (!result) return result;
    if (typeof result.select === 'function') {
        return result.select(projection);
    }
    return result;
};

const buildReferralBounties = async ({ userId }) => {
    const [jobs, referralAgg] = await Promise.all([
        Job.find({ isOpen: true, status: 'active' })
            .select('_id title companyName salaryRange createdAt')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        Referral.aggregate([
            {
                $match: {
                    $or: [
                        { referrerId: userId },
                        { referrer: userId },
                    ],
                },
            },
            {
                $group: {
                    _id: '$job',
                    referrals: { $sum: 1 },
                },
            },
        ]),
    ]);

    const referralsByJobId = new Map(referralAgg.map((row) => [String(row._id), Number(row.referrals || 0)]));

    return jobs.map((job) => {
        const baseBonus = 2000;
        return {
            id: String(job._id),
            jobId: String(job._id),
            company: job.companyName || 'Employer',
            role: job.title || 'Open Role',
            bonusValue: baseBonus,
            bonus: `INR ${baseBonus}`,
            referrals: Number(referralsByJobId.get(String(job._id)) || 0),
            expiresInDays: 7,
            category: 'General',
            totalPot: `INR ${baseBonus * 10}`,
        };
    });
};

// @desc Get user's referral stats
// @route GET /api/growth/referrals
const getReferralStats = async (req, res) => {
    try {
        const dashboard = await getReferralDashboard({ userId: req.user._id });
        if (!dashboard) {
            return res.status(404).json({ message: 'User not found' });
        }

        const referredUsers = await User.find({ referredBy: req.user._id })
            .select('name createdAt role activeRole')
            .sort({ createdAt: -1 })
            .lean();

        const totalEarnings = dashboard.rewardsGranted;
        const bounties = await buildReferralBounties({ userId: req.user._id });

        return res.json({
            referralCode: dashboard.referralCode,
            inviteLink: dashboard.inviteLink,
            totalReferred: referredUsers.length,
            creditsEarned: dashboard.creditsEarned,
            totalEarnings,
            referredUsers,
            referrals: dashboard.referrals,
            bounties,
        });
    } catch (error) {
        logger.warn({
            event: 'growth_referral_stats_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        return res.status(500).json({ message: 'Failed to load referral stats' });
    }
};

// @desc Get referral dashboard for profile
// @route GET /api/growth/referrals/dashboard
const getReferralDashboardController = async (req, res) => {
    try {
        const dashboard = await getReferralDashboard({ userId: req.user._id });
        if (!dashboard) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.json({
            dashboard,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load referral dashboard' });
    }
};

// @desc Ensure referral code and invite link
// @route GET /api/growth/referrals/invite-link
const getReferralInviteLinkController = async (req, res) => {
    try {
        const referralCode = await ensureUserReferralCode(req.user._id);
        if (!referralCode) {
            return res.status(404).json({ message: 'User not found' });
        }
        const inviteLink = buildReferralInviteLink(referralCode);

        return res.json({
            referralCode,
            inviteLink,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to generate referral invite link' });
    }
};

// @desc Submit a referral for a specific job
// @route POST /api/growth/referrals
const submitReferral = async (req, res) => {
    try {
        const { jobId, bountyId, candidateName = '', candidateContact = '' } = req.body || {};
        if (!jobId && !bountyId) {
            return res.status(400).json({ message: 'jobId or bountyId is required' });
        }

        const normalizedCandidateName = sanitizeText(candidateName, { maxLength: 120 });
        const normalizedCandidateContact = String(candidateContact || '').replace(/\s+/g, '').trim();
        if (!normalizedCandidateContact) {
            return res.status(400).json({ message: 'candidateContact is required' });
        }
        if (normalizedCandidateContact.length > 40) {
            return res.status(400).json({ message: 'candidateContact is invalid' });
        }

        let job = null;
        if (jobId) {
            if (!isValidObjectId(jobId)) {
                return res.status(400).json({ message: 'Invalid jobId' });
            }
            job = await resolveMaybeQuery(selectMaybe(Job.findById(jobId), '_id'));
            if (!job) {
                return res.status(404).json({ message: 'Job not found' });
            }
        }

        let bounty = null;
        if (bountyId) {
            if (!isValidObjectId(bountyId)) {
                return res.status(400).json({ message: 'Invalid bountyId' });
            }
            bounty = await resolveMaybeQuery(selectMaybe(Bounty.findById(bountyId), '_id'));
            if (!bounty) {
                return res.status(404).json({ message: 'Bounty not found' });
            }
        }

        const duplicate = await resolveMaybeQuery(selectMaybe(Referral.findOne({
            referrerId: req.user._id,
            ...(job ? { job: job._id } : {}),
            ...(bounty ? { bounty: bounty._id } : {}),
            candidateContact: normalizedCandidateContact,
            status: { $in: ['pending', 'in_progress', 'completed'] },
        }), '_id'));
        if (duplicate) {
            return res.status(409).json({ message: 'Referral already submitted for this candidate' });
        }

        const referral = await Referral.create({
            referrerId: req.user._id,
            referrer: req.user._id,
            job: job?._id || null,
            bounty: bounty?._id || null,
            candidateName: normalizedCandidateName,
            candidateContact: normalizedCandidateContact,
            reward: 0,
            rewardType: 'credit_unlock',
            status: 'pending',
        });

        return res.status(201).json({ referral });
    } catch (error) {
        logger.warn({
            event: 'growth_submit_referral_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        return res.status(500).json({ message: 'Failed to submit referral' });
    }
};

// @desc Generate shareable link for a job
// @route GET /api/growth/share-link/job/:jobId
const getShareableJobLink = async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId).select('_id title companyName');

        if (!job) return res.status(404).json({ message: 'Job not found' });

        const shareLink = buildJobShareLink({
            jobId: job._id,
            title: `${job.title}-${job.companyName}`,
        });

        return res.json({
            jobId: String(job._id),
            shareLink,
            preview: {
                title: job.title,
                company: job.companyName,
            },
        });
    } catch (error) {
        logger.warn({
            event: 'growth_shareable_job_link_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        return res.status(500).json({ message: 'Failed to generate share link' });
    }
};

// @desc Generate shareable public profile link
// @route GET /api/growth/share-link/profile
const getShareableProfileLink = async (req, res) => {
    try {
        const profileLink = buildProfileShareLink({
            userId: req.user._id,
            displayName: req.user.name,
        });

        return res.json({
            userId: String(req.user._id),
            shareLink: profileLink,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to generate profile share link' });
    }
};

// @desc Generate shareable community link
// @route GET /api/growth/share-link/community/:circleId
const getShareableCommunityLink = async (req, res) => {
    try {
        const circle = await Circle.findById(req.params.circleId).select('_id name');
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }

        return res.json({
            circleId: String(circle._id),
            shareLink: buildCommunityShareLink({
                circleId: circle._id,
                name: circle.name,
            }),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to generate community link' });
    }
};

// @desc Generate shareable bounty link
// @route GET /api/growth/share-link/bounty/:postId
const getShareableBountyLink = async (req, res) => {
    try {
        const targetId = String(req.params.postId || '').trim();
        if (!isValidObjectId(targetId)) {
            return res.status(400).json({ message: 'Invalid bounty id' });
        }

        const bountyPost = await resolveMaybeQuery(
            selectMaybe(Post.findById(targetId), '_id content postType type')
        );
        if (!bountyPost) {
            const bounty = await resolveMaybeQuery(selectMaybe(Bounty.findById(targetId), '_id title'));
            if (!bounty) {
                return res.status(404).json({ message: 'Bounty not found' });
            }
            return res.json({
                bountyId: String(bounty._id),
                shareLink: buildBountyShareLink({
                    bountyId: bounty._id,
                    title: bounty.title || 'bounty',
                }),
            });
        }

        if (String(bountyPost.postType || bountyPost.type || '').toLowerCase() !== 'bounty') {
            return res.status(404).json({ message: 'Bounty not found' });
        }

        return res.json({
            bountyId: String(bountyPost._id),
            shareLink: buildBountyShareLink({
                bountyId: bountyPost._id,
                title: bountyPost.content || bountyPost.postType || bountyPost.type || 'bounty',
            }),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to generate bounty link' });
    }
};

// @desc Deterministic experiment assignment
// @route GET /api/growth/experiments/:key/assignment
const getExperimentAssignment = async (req, res) => {
    try {
        const { key } = req.params;
        const variantA = req.query.variantA || 'A';
        const variantB = req.query.variantB || 'B';

        const assignment = await assignUserToExperiment({
            userId: req.user._id,
            key,
            variantA,
            variantB,
            persist: true,
        });

        return res.json(assignment);
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to assign experiment' });
    }
};

// @desc Upsert experiment
// @route POST /api/growth/experiments
const upsertExperimentController = async (req, res) => {
    try {
        const { key, variantA = 'A', variantB = 'B' } = req.body || {};
        if (!key) {
            return res.status(400).json({ message: 'key is required' });
        }

        const experiment = await getOrCreateExperiment({ key, variantA, variantB });
        return res.status(201).json({ experiment });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to save experiment' });
    }
};

// @desc Growth metrics overview
// @route GET /api/growth/metrics
const getGrowthMetrics = async (req, res) => {
    try {
        const latest = await getLatestGrowthMetrics();
        return res.json({ metrics: latest });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load growth metrics' });
    }
};

// @desc Recompute growth metrics for a day
// @route POST /api/growth/metrics/compute
const computeGrowthMetrics = async (req, res) => {
    try {
        const date = req.body?.date ? new Date(req.body.date) : new Date();
        if (Number.isNaN(date.getTime())) {
            return res.status(400).json({ message: 'Invalid date' });
        }

        const metrics = await upsertGrowthMetricsForDay(date);
        return res.json({ metrics });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to compute growth metrics' });
    }
};

// @desc Conversion nudges
// @route GET /api/growth/conversion-nudges
const getConversionNudgesController = async (req, res) => {
    try {
        const nudges = await getConversionNudges({ user: req.user });
        return res.json(nudges);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch conversion nudges' });
    }
};

// @desc Monetization intelligence
// @route GET /api/growth/monetization-intelligence
const getMonetizationIntelligenceController = async (req, res) => {
    try {
        const intelligence = await getMonetizationIntelligence({ userId: req.user._id });
        return res.json({ intelligence });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load monetization intelligence' });
    }
};

// @desc User network effect score
// @route GET /api/growth/network-score
const getNetworkScoreController = async (req, res) => {
    try {
        const score = await recomputeUserNetworkScore({ userId: req.user._id });
        return res.json({ score });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to compute network score' });
    }
};

// @desc Funnel visualization
// @route GET /api/growth/funnel
const getFunnelVisualizationController = async (req, res) => {
    try {
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        const funnel = await getFunnelVisualization({ from, to });
        return res.json({ funnel });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load funnel visualization' });
    }
};

const buildPublicPayload = ({ title, description, url, type, entity }) => ({
    entity,
    seo: buildSeoMetadata({
        title,
        description,
        url,
        type,
    }),
});

// @desc Public worker profile page payload
// @route GET /api/growth/public/workers/:slug
const getPublicWorkerProfile = async (req, res) => {
    try {
        const id = toObjectIdOrNull(req.params.slug);
        if (!id) return res.status(400).json({ message: 'Invalid worker id' });

        const worker = await WorkerProfile.findById(id)
            .populate('user', 'name city country activeRole')
            .lean();
        if (!worker) return res.status(404).json({ message: 'Worker profile not found' });

        const displayName = worker?.user?.name || [worker.firstName, worker.lastName].filter(Boolean).join(' ').trim() || 'Worker';
        const url = buildProfileShareLink({ userId: worker.user?._id || worker.user, displayName });
        return res.json(buildPublicPayload({
            title: `${displayName} - Hire Worker Profile`,
            description: `${displayName} is available for opportunities in ${worker.city || worker.user?.city || 'your region'}.`,
            url,
            type: 'profile',
            entity: {
                id: String(worker._id),
                name: displayName,
                city: worker.city,
                country: worker.country || worker.user?.country || 'IN',
                roleProfiles: worker.roleProfiles || [],
            },
        }));
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load public worker profile' });
    }
};

// @desc Public employer profile page payload
// @route GET /api/growth/public/employers/:slug
const getPublicEmployerProfile = async (req, res) => {
    try {
        const id = toObjectIdOrNull(req.params.slug);
        if (!id) return res.status(400).json({ message: 'Invalid employer id' });

        const employer = await EmployerProfile.findOne({ user: id })
            .populate('user', 'name city country activeRole')
            .lean();
        if (!employer) return res.status(404).json({ message: 'Employer profile not found' });

        const displayName = employer.companyName || employer?.user?.name || 'Employer';
        const url = buildProfileShareLink({ userId: employer.user?._id || employer.user, displayName });
        return res.json(buildPublicPayload({
            title: `${displayName} - Hire Employer Profile`,
            description: `${displayName} is hiring in ${employer.location || employer.user?.city || 'multiple regions'}.`,
            url,
            type: 'organization',
            entity: {
                id: String(employer._id),
                companyName: employer.companyName,
                location: employer.location,
                country: employer.country || employer.user?.country || 'IN',
                website: employer.website || null,
                industry: employer.industry || null,
            },
        }));
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load public employer profile' });
    }
};

// @desc Public job page payload
// @route GET /api/growth/public/jobs/:slug
const getPublicJobPage = async (req, res) => {
    try {
        const id = toObjectIdOrNull(req.params.slug);
        if (!id) return res.status(400).json({ message: 'Invalid job id' });

        const job = await Job.findById(id)
            .select('title companyName location salaryRange requirements countryCode regionCode')
            .lean();
        if (!job) return res.status(404).json({ message: 'Job not found' });

        const url = buildJobShareLink({
            jobId: job._id,
            title: `${job.title}-${job.companyName}`,
        });

        return res.json(buildPublicPayload({
            title: `${job.title} at ${job.companyName}`,
            description: `${job.companyName} is hiring for ${job.title} in ${job.location}.`,
            url,
            type: 'job',
            entity: {
                id: String(job._id),
                title: job.title,
                companyName: job.companyName,
                location: job.location,
                salaryRange: job.salaryRange,
                requirements: job.requirements || [],
                countryCode: job.countryCode,
                regionCode: job.regionCode,
            },
        }));
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load public job page' });
    }
};

// @desc Public community page payload
// @route GET /api/growth/public/community/:slug
const getPublicCommunityPage = async (req, res) => {
    try {
        const id = toObjectIdOrNull(req.params.slug);
        if (!id) return res.status(400).json({ message: 'Invalid community id' });

        const community = await Circle.findById(id)
            .select('name description skill location members createdAt')
            .lean();
        if (!community) return res.status(404).json({ message: 'Community not found' });

        const url = buildCommunityShareLink({
            circleId: community._id,
            name: community.name,
        });

        return res.json(buildPublicPayload({
            title: `${community.name} Community`,
            description: community.description || `${community.name} is a professional community on Hire.`,
            url,
            type: 'community',
            entity: {
                id: String(community._id),
                name: community.name,
                description: community.description,
                skill: community.skill,
                location: community.location,
                memberCount: Array.isArray(community.members) ? community.members.length : 0,
                createdAt: community.createdAt,
            },
        }));
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load public community page' });
    }
};

module.exports = {
    getReferralStats,
    getReferralDashboardController,
    getReferralInviteLinkController,
    submitReferral,
    getShareableJobLink,
    getShareableProfileLink,
    getShareableCommunityLink,
    getShareableBountyLink,
    getExperimentAssignment,
    upsertExperimentController,
    getGrowthMetrics,
    computeGrowthMetrics,
    getConversionNudgesController,
    getMonetizationIntelligenceController,
    getNetworkScoreController,
    getFunnelVisualizationController,
    getPublicWorkerProfile,
    getPublicEmployerProfile,
    getPublicJobPage,
    getPublicCommunityPage,
};
