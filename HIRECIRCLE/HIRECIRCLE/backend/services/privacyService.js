const mongoose = require('mongoose');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Post = require('../models/Post');
const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const Report = require('../models/Report');
const Subscription = require('../models/Subscription');
const UserTrustScore = require('../models/UserTrustScore');
const Event = require('../models/Event').Event;
const Offer = require('../models/Offer');
const Escrow = require('../models/Escrow');
const InterviewSchedule = require('../models/InterviewSchedule');
const RevenueEvent = require('../models/RevenueEvent');
const CallSession = require('../models/CallSession');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Wallet = require('../models/Wallet');
const Referral = require('../models/Referral');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const GrowthFunnelEvent = require('../models/GrowthFunnelEvent');
const { TrustGraphNode } = require('../models/TrustGraphNode');
const { TrustGraphEdge } = require('../models/TrustGraphEdge');
const { recomputeTrustGraphForUser } = require('./trustGraphService');

const toId = (value) => String(value || '').trim();

const ensureAnonymizedFixtures = async () => {
    let anonymizedUser = await User.findOne({ email: 'deleted-account@hirecircle.invalid' }).select('_id').lean();
    if (!anonymizedUser) {
        const created = await User.create({
            name: 'Deleted Account',
            email: 'deleted-account@hirecircle.invalid',
            password: 'DeletedAccount#2026StrongPass!',
            role: 'candidate',
            roles: ['worker', 'employer'],
            activeRole: 'worker',
            primaryRole: 'worker',
            hasSelectedRole: true,
            hasCompletedProfile: true,
            isVerified: true,
            isEmailVerified: true,
            isDeleted: true,
            deletedAt: new Date(),
            deletionLifecycle: {
                status: 'purged',
                requestedAt: new Date(),
                purgeAfter: null,
                reason: 'system_placeholder',
            },
        });
        anonymizedUser = { _id: created._id };
    }

    let anonymizedWorker = await WorkerProfile.findOne({ user: anonymizedUser._id }).select('_id').lean();
    if (!anonymizedWorker) {
        const created = await WorkerProfile.create({
            user: anonymizedUser._id,
            firstName: 'Deleted',
            lastName: 'User',
            city: 'Unknown',
            country: 'IN',
            totalExperience: 0,
            roleProfiles: [{
                roleName: 'Archived',
                experienceInRole: 0,
                expectedSalary: 0,
                skills: [],
                lastUpdated: new Date(),
            }],
            isAvailable: false,
        });
        anonymizedWorker = { _id: created._id };
    }

    let anonymizedEmployer = await EmployerProfile.findOne({ user: anonymizedUser._id }).select('_id').lean();
    if (!anonymizedEmployer) {
        const created = await EmployerProfile.create({
            user: anonymizedUser._id,
            companyName: 'Deleted Account',
            location: 'Unknown',
            industry: 'Archived',
            country: 'IN',
        });
        anonymizedEmployer = { _id: created._id };
    }

    let anonymizedJob = await Job.findOne({
        employerId: anonymizedUser._id,
        title: '[Deleted Account Archive Job]',
    }).select('_id').lean();
    if (!anonymizedJob) {
        const created = await Job.create({
            employerId: anonymizedUser._id,
            title: '[Deleted Account Archive Job]',
            companyName: 'Deleted Account',
            salaryRange: '0-0',
            location: 'Unknown',
            requirements: [],
            isOpen: false,
            status: 'closed',
            workflowState: 'completed',
            isArchived: true,
            archivedAt: new Date(),
            closedAt: new Date(),
            closedReason: 'placeholder',
        });
        anonymizedJob = { _id: created._id };
    }

    let anonymizedApplication = await Application.findOne({
        job: anonymizedJob._id,
        worker: anonymizedWorker._id,
        employer: anonymizedUser._id,
    }).select('_id').lean();
    if (!anonymizedApplication) {
        const created = await Application.create({
            job: anonymizedJob._id,
            worker: anonymizedWorker._id,
            employer: anonymizedUser._id,
            initiatedBy: 'worker',
            status: 'withdrawn',
            isArchived: true,
            archivedAt: new Date(),
        });
        anonymizedApplication = { _id: created._id };
    }

    return {
        anonymizedUserId: anonymizedUser._id,
        anonymizedWorkerId: anonymizedWorker._id,
        anonymizedJobId: anonymizedJob._id,
        anonymizedApplicationId: anonymizedApplication._id,
    };
};

const deleteUserDataCascade = async ({ userId }) => {
    if (!userId) {
        throw new Error('userId is required for deletion');
    }
    const userIdText = toId(userId);

    const {
        anonymizedUserId,
        anonymizedWorkerId,
        anonymizedJobId,
    } = await ensureAnonymizedFixtures();

    const workerProfiles = await WorkerProfile.find({ user: userId }).select('_id').lean();
    const workerProfileIds = workerProfiles.map((row) => row._id);
    const workerProfileIdSet = new Set(workerProfileIds.map((id) => toId(id)));

    const jobs = await Job.find({ employerId: userId }).select('_id').lean();
    const jobIds = jobs.map((row) => row._id);
    const jobIdSet = new Set(jobIds.map((id) => toId(id)));

    const applications = await Application.find({
        $or: [
            { employer: userId },
            ...(workerProfileIds.length ? [{ worker: { $in: workerProfileIds } }] : []),
            ...(jobIds.length ? [{ job: { $in: jobIds } }] : []),
        ],
    }).select('_id').lean();
    const applicationIds = applications.map((row) => row._id);

    const offers = await Offer.find({
        $or: [
            { employerId: userId },
            ...(workerProfileIds.length ? [{ candidateId: { $in: workerProfileIds } }] : []),
            ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
            ...(applicationIds.length ? [{ applicationId: { $in: applicationIds } }] : []),
        ],
    }).select('_id').lean();
    const offerIds = offers.map((row) => row._id);

    const trustNodes = await TrustGraphNode.find({
        $or: [
            { externalId: userIdText },
            { ownerUserId: userId },
        ],
    })
        .select('_id externalId')
        .lean();
    const trustNodeIdSet = new Set(trustNodes.map((row) => toId(row._id)));
    const trustEdges = trustNodeIdSet.size > 0
        ? await TrustGraphEdge.find({
            $or: [
                { fromNode: { $in: Array.from(trustNodeIdSet) } },
                { toNode: { $in: Array.from(trustNodeIdSet) } },
            ],
        })
            .select('_id fromNode toNode metadata')
            .lean()
        : [];

    const counterpartyIds = new Set();
    for (const edge of trustEdges) {
        const fromId = toId(edge.fromNode);
        const toIdValue = toId(edge.toNode);
        if (!trustNodeIdSet.has(fromId)) {
            const node = await TrustGraphNode.findById(fromId).select('externalId').lean();
            if (node?.externalId) counterpartyIds.add(toId(node.externalId));
        }
        if (!trustNodeIdSet.has(toIdValue)) {
            const node = await TrustGraphNode.findById(toIdValue).select('externalId').lean();
            if (node?.externalId) counterpartyIds.add(toId(node.externalId));
        }
    }

    const relatedEscrows = await Escrow.find({
        $or: [
            { employerId: userId },
            { workerId: userId },
            ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
        ],
    }).lean();
    const escrowUpdateOperations = [];
    let resolvedEscrows = 0;
    for (const escrow of relatedEscrows) {
        const updateSet = {
            metadata: {
                ...(escrow.metadata || {}),
                accountDeletionResolved: true,
                accountDeletionResolvedAt: new Date(),
            },
        };

        if (toId(escrow.employerId) === userIdText) {
            updateSet.employerId = anonymizedUserId;
        }
        if (toId(escrow.workerId) === userIdText) {
            updateSet.workerId = anonymizedUserId;
        }
        if (jobIdSet.has(toId(escrow.jobId))) {
            updateSet.jobId = anonymizedJobId;
        }

        if (['funded', 'disputed'].includes(String(escrow.status || '').toLowerCase()) || escrow.isFrozen) {
            resolvedEscrows += 1;
            updateSet.status = 'refunded';
            updateSet.refundedAt = escrow.refundedAt || new Date();
            updateSet.isFrozen = false;
        }

        escrowUpdateOperations.push(
            Escrow.updateOne({ _id: escrow._id }, { $set: updateSet })
        );
    }

    const [
        softDeletedMessages,
        deletedApplications,
        deletedJobs,
        deletedPosts,
        deletedCirclePosts,
        deletedNotifications,
        deletedReports,
        deletedEvents,
        deletedSubscriptions,
        deletedTrustRows,
        deletedWorkerProfiles,
        deletedEmployerProfiles,
        deletedOffers,
        updatedEscrows,
        deletedInterviewSchedules,
        deletedRevenueEvents,
        deletedCallSessions,
        deletedInterviewProcessingJobs,
        deletedHiringLifecycleEvents,
        deletedOwnedCircles,
        deletedWallets,
        detachedReferrals,
        anonymizedGrowthEvents,
        anonymizedAnalyticsEvents,
        deletedTrustEdges,
        deletedTrustNodes,
        detachedReferredByUsers,
    ] = await Promise.all([
        Message.updateMany({
            $or: [
                { sender: userId },
                ...(applicationIds.length ? [{ applicationId: { $in: applicationIds } }] : []),
            ],
        }, {
                $set: {
                    sender: anonymizedUserId,
                    text: '[deleted by user request]',
                    transcript: '',
                    audioUrl: '',
                attachmentUrl: '',
                mimeType: '',
                sizeBytes: null,
                isSoftDeleted: true,
                softDeletedAt: new Date(),
                softDeleteReason: 'account_deleted',
            },
        }),
        Application.deleteMany({ _id: { $in: applicationIds } }),
        Job.deleteMany({ _id: { $in: jobIds } }),
        Post.deleteMany({ user: userId }),
        CirclePost.deleteMany({ user: userId }),
        Notification.deleteMany({ user: userId }),
        Report.deleteMany({
            $or: [
                { reporterId: userId },
                { targetType: 'user', targetId: String(userId) },
            ],
        }),
        Event.deleteMany({ userId }),
        Subscription.deleteMany({ userId }),
        UserTrustScore.deleteMany({ userId }),
        WorkerProfile.deleteMany({ user: userId }),
        EmployerProfile.deleteMany({ user: userId }),
        Offer.deleteMany({ _id: { $in: offerIds } }),
        Promise.all(escrowUpdateOperations),
        InterviewSchedule.deleteMany({
            $or: [
                { employerId: userId },
                ...(workerProfileIds.length ? [{ candidateId: { $in: workerProfileIds } }] : []),
                ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
                ...(applicationIds.length ? [{ applicationId: { $in: applicationIds } }] : []),
            ],
        }),
        RevenueEvent.deleteMany({ employerId: userId }),
        CallSession.deleteMany({
            $or: [
                { callerId: userId },
                { calleeId: userId },
                ...(applicationIds.length ? [{ applicationId: { $in: applicationIds } }] : []),
            ],
        }),
        InterviewProcessingJob.deleteMany({ userId }),
        HiringLifecycleEvent.deleteMany({
            $or: [
                { employerId: userId },
                ...(workerProfileIds.length ? [{ workerId: { $in: workerProfileIds } }] : []),
                ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
                ...(applicationIds.length ? [{ applicationId: { $in: applicationIds } }] : []),
            ],
        }),
        Circle.deleteMany({ createdBy: userId }),
        Wallet.deleteMany({ userId }),
        Referral.updateMany({
            $or: [
                { referrerId: userId },
                { referrer: userId },
                { referredUserId: userId },
            ],
        }, {
            $set: {
                referrerId: null,
                referrer: null,
                referredUserId: null,
                candidateName: '[redacted]',
                candidateContact: '[redacted]',
            },
        }),
        GrowthFunnelEvent.updateMany(
            { user: userId },
            {
                $set: {
                    user: anonymizedUserId,
                    'metadata.accountDeletedAnonymized': true,
                },
            }
        ),
        AnalyticsEvent.updateMany(
            { user: userId },
            {
                $set: {
                    user: null,
                    'metadata.accountDeletedAnonymized': true,
                },
            }
        ),
        trustNodeIdSet.size > 0
            ? TrustGraphEdge.deleteMany({
                $or: [
                    { fromNode: { $in: Array.from(trustNodeIdSet) } },
                    { toNode: { $in: Array.from(trustNodeIdSet) } },
                ],
            })
            : { deletedCount: 0 },
        TrustGraphNode.deleteMany({
            $or: [
                { externalId: userIdText },
                { ownerUserId: userId },
            ],
        }),
        User.updateMany({ referredBy: userId }, { $set: { referredBy: null } }),
    ]);

    await Circle.updateMany(
        {
            $or: [
                { members: userId },
                { memberIds: userId },
                { adminIds: userId },
                { 'joinRequests.userId': userId },
            ],
        },
        {
            $pull: { members: userId },
            $pullAll: {
                memberIds: [userId],
                adminIds: [userId],
            },
        }
    );
    await Circle.updateMany(
        { 'joinRequests.userId': userId },
        { $pull: { joinRequests: { userId } } }
    );

    const trustRecomputeTargets = Array.from(counterpartyIds)
        .filter((candidateId) => mongoose.Types.ObjectId.isValid(candidateId));
    await Promise.allSettled(
        trustRecomputeTargets.map((counterpartyId) => recomputeTrustGraphForUser({
            userId: counterpartyId,
            reason: 'account_deletion_cascade',
        }))
    );

    const deletedUser = await User.findByIdAndDelete(userId);

    return {
        deleted: Boolean(deletedUser),
        counts: {
            messagesSoftDeleted: softDeletedMessages.modifiedCount || 0,
            applications: deletedApplications.deletedCount || 0,
            jobs: deletedJobs.deletedCount || 0,
            posts: deletedPosts.deletedCount || 0,
            circlePosts: deletedCirclePosts.deletedCount || 0,
            notifications: deletedNotifications.deletedCount || 0,
            reports: deletedReports.deletedCount || 0,
            events: deletedEvents.deletedCount || 0,
            subscriptions: deletedSubscriptions.deletedCount || 0,
            trustRows: deletedTrustRows.deletedCount || 0,
            workerProfiles: deletedWorkerProfiles.deletedCount || 0,
            employerProfiles: deletedEmployerProfiles.deletedCount || 0,
            offers: deletedOffers.deletedCount || 0,
            escrowsUpdated: Array.isArray(updatedEscrows) ? updatedEscrows.length : 0,
            escrowsResolved: resolvedEscrows,
            interviewSchedules: deletedInterviewSchedules.deletedCount || 0,
            revenueEvents: deletedRevenueEvents.deletedCount || 0,
            callSessions: deletedCallSessions.deletedCount || 0,
            interviewProcessingJobs: deletedInterviewProcessingJobs.deletedCount || 0,
            hiringLifecycleEvents: deletedHiringLifecycleEvents.deletedCount || 0,
            ownedCircles: deletedOwnedCircles.deletedCount || 0,
            wallets: deletedWallets.deletedCount || 0,
            referralsDetached: detachedReferrals.modifiedCount || 0,
            growthEventsAnonymized: anonymizedGrowthEvents.modifiedCount || 0,
            analyticsEventsAnonymized: anonymizedAnalyticsEvents.modifiedCount || 0,
            trustEdgesDeleted: deletedTrustEdges.deletedCount || 0,
            trustNodesDeleted: deletedTrustNodes.deletedCount || 0,
            referredByDetached: detachedReferredByUsers.modifiedCount || 0,
            trustRecomputeTriggered: trustRecomputeTargets.length,
        },
    };
};

module.exports = {
    deleteUserDataCascade,
};
