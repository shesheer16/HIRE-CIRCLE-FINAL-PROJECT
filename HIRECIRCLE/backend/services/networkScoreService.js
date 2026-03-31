const Referral = require('../models/Referral');
const Post = require('../models/Post');
const CirclePost = require('../models/CirclePost');
const Application = require('../models/Application');
const Message = require('../models/Message');
const WorkerProfile = require('../models/WorkerProfile');
const UserNetworkScore = require('../models/UserNetworkScore');

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const countCommentResponsesByUser = async (userId) => {
    const rows = await Post.aggregate([
        { $unwind: '$comments' },
        { $match: { 'comments.user': userId } },
        { $count: 'count' },
    ]);
    return Number(rows[0]?.count || 0);
};

const recomputeUserNetworkScore = async ({ userId }) => {
    if (!userId) return null;

    const [
        completedReferrals,
        postsCount,
        circlePostsCount,
        commentResponsesCount,
        messageResponsesCount,
        employerHiresCount,
        workerProfile,
    ] = await Promise.all([
        Referral.countDocuments({
            $or: [{ referrerId: userId }, { referrer: userId }],
            status: 'completed',
        }),
        Post.countDocuments({
            $or: [{ user: userId }, { authorId: userId }],
        }),
        CirclePost.countDocuments({ user: userId }),
        countCommentResponsesByUser(userId),
        Message.countDocuments({ sender: userId }),
        Application.countDocuments({ employer: userId, status: 'hired' }),
        WorkerProfile.findOne({ user: userId }).select('_id').lean(),
    ]);

    const workerHiresCount = workerProfile?._id
        ? await Application.countDocuments({ worker: workerProfile._id, status: 'hired' })
        : 0;

    const responses = circlePostsCount + commentResponsesCount;
    const hires = employerHiresCount + workerHiresCount;

    const engagementRaw =
        Number(postsCount * 1.2)
        + Number(responses * 1.5)
        + Number(messageResponsesCount * 0.4)
        + Number(completedReferrals * 2.5)
        + Number(hires * 3);

    const engagement = Number(clamp(Number(engagementRaw.toFixed(2)), 0, 100));

    const score = Number(clamp(
        (completedReferrals * 8)
        + (postsCount * 2)
        + (responses * 3)
        + (hires * 6)
        + (engagement * 0.5),
        0,
        1000
    ).toFixed(2));

    const updated = await UserNetworkScore.findOneAndUpdate(
        { user: userId },
        {
            $set: {
                user: userId,
                referrals: completedReferrals,
                posts: postsCount,
                responses,
                hires,
                engagement,
                score,
                computedAt: new Date(),
            },
        },
        { upsert: true, new: true }
    ).lean();

    return updated;
};

module.exports = {
    recomputeUserNetworkScore,
};
