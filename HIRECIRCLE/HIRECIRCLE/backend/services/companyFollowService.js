'use strict';
/**
 * companyFollowService.js
 * Feature #37 — Follow Company
 */
const CompanyFollow = require('../models/CompanyFollow');

async function followCompany(followerId, employerUserId, companyName = '') {
    if (String(followerId) === String(employerUserId)) {
        throw Object.assign(new Error('Cannot follow yourself'), { code: 400 });
    }
    try {
        const follow = await CompanyFollow.create({ followerId, employerUserId, companyName });
        return { following: true, followId: follow._id };
    } catch (err) {
        if (err.code === 11000) return { following: true, alreadyFollowing: true };
        throw err;
    }
}

async function unfollowCompany(followerId, employerUserId) {
    const result = await CompanyFollow.deleteOne({ followerId, employerUserId });
    return { unfollowed: result.deletedCount > 0 };
}

async function getFollowStatus(followerId, employerUserId) {
    const exists = await CompanyFollow.exists({ followerId, employerUserId });
    return { following: !!exists };
}

async function getFollowerCount(employerUserId) {
    const count = await CompanyFollow.countDocuments({ employerUserId });
    return { followerCount: count };
}

async function getFollowedCompanies(followerId) {
    return CompanyFollow.find({ followerId })
        .sort({ createdAt: -1 })
        .select('employerUserId companyName notificationsEnabled createdAt')
        .lean();
}

async function toggleNotifications(followerId, employerUserId, enabled) {
    await CompanyFollow.updateOne({ followerId, employerUserId }, { notificationsEnabled: enabled });
    return { notificationsEnabled: enabled };
}

module.exports = {
    followCompany,
    unfollowCompany,
    getFollowStatus,
    getFollowerCount,
    getFollowedCompanies,
    toggleNotifications,
};
