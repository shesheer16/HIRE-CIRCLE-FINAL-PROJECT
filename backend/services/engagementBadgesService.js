'use strict';
/**
 * engagementBadgesService.js
 * Feature #32: Daily login streak badges
 * Feature #33: Achievement badges (first apply/interview)
 * Feature #50: Animated reward confetti on milestone
 * Feature #56: Job count badge on app icon (computed status)
 * 
 * Non-disruptive: pure computation, returning UI states for frontend to render.
 */

const BADGES = {
    first_apply: { id: 'first_apply', name: 'First Step', icon: '🚀', description: 'Applied to your first job' },
    first_interview: { id: 'first_interview', name: 'Interview Ready', icon: '🎤', description: 'Scheduled your first interview' },
    streak_3: { id: 'streak_3', name: 'On Fire', icon: '🔥', description: 'Logged in 3 days in a row' },
    streak_7: { id: 'streak_7', name: 'Weekly Warrior', icon: '⭐', description: 'Logged in 7 days in a row' },
};

/**
 * Compute current login streak based on login timestamps.
 * Assumes sorted array of recent login Dates.
 */
function computeLoginStreak(loginDates = []) {
    if (!loginDates.length) return 0;
    let streak = 1;
    let lastDate = new Date(loginDates[0]).setHours(0, 0, 0, 0);
    const today = new Date().setHours(0, 0, 0, 0);

    // If last login wasn't today or yesterday, streak is broken
    if (today - lastDate > 86400000 * 1) return 0;

    for (let i = 1; i < loginDates.length; i++) {
        const currentDate = new Date(loginDates[i]).setHours(0, 0, 0, 0);
        const diff = (lastDate - currentDate) / 86400000;
        if (diff === 1) {
            streak++;
            lastDate = currentDate;
        } else if (diff > 1) {
            break; // streak broken
        }
    }
    return streak;
}

/**
 * Assess earned badges for a user.
 */
function evaluateUserBadges(stats = { applicationsCount: 0, interviewsCount: 0, loginDates: [] }) {
    const earned = [];
    const newMilestones = [];

    if (stats.applicationsCount >= 1) earned.push(BADGES.first_apply);
    if (stats.interviewsCount >= 1) earned.push(BADGES.first_interview);

    const streak = computeLoginStreak(stats.loginDates);
    if (streak >= 7) earned.push(BADGES.streak_7);
    else if (streak >= 3) earned.push(BADGES.streak_3);

    return { streak, earned, newMilestones };
}

/**
 * Generate confetti trigger flag for new milestones (e.g., just crossed a threshold).
 */
function checkConfettiTrigger(previousStats, currentStats) {
    if (previousStats.applicationsCount === 0 && currentStats.applicationsCount === 1) return true;
    if (previousStats.interviewsCount === 0 && currentStats.interviewsCount === 1) return true;

    const prevStreak = computeLoginStreak(previousStats.loginDates || []);
    const currStreak = computeLoginStreak(currentStats.loginDates || []);

    if (prevStreak < 7 && currStreak >= 7) return true;

    return false;
}

/**
 * Feature #56: Job count badge on app icon
 * Returns the number to display on the OS app icon badge (new matches + unread messages + pending actions)
 */
function computeAppIconBadgeCount(unseenMatches = 0, unreadMessages = 0, pendingOffers = 0) {
    return unseenMatches + unreadMessages + pendingOffers;
}

module.exports = {
    BADGES,
    computeLoginStreak,
    evaluateUserBadges,
    checkConfettiTrigger,
    computeAppIconBadgeCount
};
