'use strict';
/**
 * dailyStreakService.js
 * Feature #32 — Daily Login Streak Badges
 * Feature #29 — Microcopy Gamification
 *
 * Tracks consecutive daily login streaks per user.
 * Awards streak badges:
 *   3d → Flame, 7d → Hot Streak, 14d → Champion, 30d → Legend
 *
 * Non-disruptive: reads/writes only streak metadata on User model.
 */

const User = require('../models/userModel');

const STREAK_BADGES = [
    { days: 30, badge: 'Legend', emoji: '🏆', message: 'Legendary! 30-day streak!' },
    { days: 14, badge: 'Champion', emoji: '⚡', message: 'Champion! 2-week streak!' },
    { days: 7, badge: 'Hot Streak', emoji: '🔥', message: 'Hot streak! 7 days in a row!' },
    { days: 3, badge: 'Flame', emoji: '🌟', message: 'Warming up! 3-day streak!' },
    { days: 1, badge: null, emoji: '', message: 'Welcome back!' },
];

function resolveStreakBadge(streak) {
    return STREAK_BADGES.find((b) => streak >= b.days) || STREAK_BADGES[STREAK_BADGES.length - 1];
}

/**
 * Record a daily login and update streak.
 * @param {string} userId
 * @returns {{ streak: number, badge: string|null, message: string }}
 */
async function recordDailyLogin(userId) {
    const user = await User.findById(userId).select('streakLastLoginDate streakCount').lean();
    if (!user) throw Object.assign(new Error('User not found'), { code: 404 });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastLogin = user.streakLastLoginDate ? new Date(user.streakLastLoginDate) : null;

    let streak = Number(user.streakCount || 0);

    if (lastLogin) {
        const lastLoginDay = new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate());
        const diffDays = Math.round((today - lastLoginDay) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            // Same day — no update
            return { streak, ...resolveStreakBadge(streak) };
        } else if (diffDays === 1) {
            streak += 1; // Consecutive
        } else {
            streak = 1; // Broken streak, restart
        }
    } else {
        streak = 1;
    }

    await User.updateOne(
        { _id: userId },
        { $set: { streakCount: streak, streakLastLoginDate: today } }
    );

    const { badge, emoji, message } = resolveStreakBadge(streak);
    return { streak, badge, emoji, message };
}

/**
 * Get current streak for a user.
 */
async function getStreakStatus(userId) {
    const user = await User.findById(userId).select('streakCount streakLastLoginDate').lean();
    const streak = Number(user?.streakCount || 0);
    return { streak, ...resolveStreakBadge(streak) };
}

module.exports = { recordDailyLogin, getStreakStatus, resolveStreakBadge, STREAK_BADGES };
