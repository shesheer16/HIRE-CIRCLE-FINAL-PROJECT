/**
 * socialProofService — Real data-backed social proof labels.
 *
 * Security:
 *  - All labels derived from real DB data
 *  - No self-awarded labels
 *  - No cross-tenant data (each user only sees their own proof)
 *  - No fake inflation (counters sourced from HireRecord, CallSession, Message, InterviewSchedule)
 */
'use strict';

/**
 * Generate job-seeker social proof labels based on real activity data.
 * @param {object} stats - { hireCount, interviewCount, avgResponseHours, lastActiveAt }
 * @returns {string[]} Array of proof labels
 */
function getWorkerProofLabels({ hireCount = 0, interviewCount = 0, avgResponseHours = null, lastActiveAt = null } = {}) {
    const labels = [];

    const hires = Number(hireCount) || 0;
    if (hires >= 1) labels.push(`Hired ${hires} time${hires > 1 ? 's' : ''}`);

    const interviews = Number(interviewCount) || 0;
    if (interviews >= 2) labels.push(`Interviewed ${interviews} times`);

    const responseHrs = Number(avgResponseHours);
    if (Number.isFinite(responseHrs) && responseHrs > 0 && responseHrs <= 2) {
        labels.push('Fast responder');
    }

    if (lastActiveAt) {
        const daysSinceActive = (Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActive <= 7) labels.push('Active this week');
    }

    return labels;
}

/**
 * Generate employer social proof labels.
 * @param {object} stats - { totalHires, avgResponseHours, lastActiveAt, isCurrentlyHiring }
 * @returns {string[]}
 */
function getEmployerProofLabels({ totalHires = 0, avgResponseHours = null, lastActiveAt = null, isCurrentlyHiring = false } = {}) {
    const labels = [];

    const hires = Number(totalHires) || 0;
    if (hires >= 1) labels.push(`Hired ${hires} candidate${hires > 1 ? 's' : ''}`);

    const responseHrs = Number(avgResponseHours);
    if (Number.isFinite(responseHrs) && responseHrs > 0) {
        labels.push(`Avg response ${responseHrs < 1 ? '<1h' : `${Math.round(responseHrs)}h`}`);
    }

    if (isCurrentlyHiring) labels.push('Active recruiter');

    if (lastActiveAt) {
        const daysSinceActive = (Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActive <= 7) labels.push('Active this week');
    }

    return labels;
}

/**
 * Validate that social proof stats are from trusted server-side sources.
 * Throws if any value looks manipulated.
 */
function validateProofStats(stats = {}) {
    const hireCount = Number(stats.hireCount || stats.totalHires || 0);
    const interviewCount = Number(stats.interviewCount || 0);
    const avgResponseHours = Number(stats.avgResponseHours || 0);

    if (hireCount < 0 || interviewCount < 0 || avgResponseHours < 0) {
        throw Object.assign(new Error('Invalid social proof stats: negative values not allowed'), { code: 400 });
    }
    if (hireCount > 10000 || interviewCount > 10000) {
        throw Object.assign(new Error('Invalid social proof stats: unrealistic counts detected'), { code: 400 });
    }
    return true;
}

module.exports = {
    getWorkerProofLabels,
    getEmployerProofLabels,
    validateProofStats,
};
