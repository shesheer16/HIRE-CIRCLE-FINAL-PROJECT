'use strict';
/**
 * employerAnalyticsService.js
 * Feature #70 — Employer Analytics Dashboard
 * Feature #71 — Premium Applicant Insights Pack
 *
 * Pure analytics computation layer for employer dashboards.
 * Non-disruptive: additive. Does not modify job/application models.
 */

/**
 * Build summary analytics from a list of application records.
 * #70 — Employer Analytics Dashboard
 */
function buildAnalyticsSummary(applications = []) {
    const total = applications.length;
    const statuses = {};
    let totalTime = 0;
    let timedCount = 0;

    applications.forEach((app) => {
        const s = app.status || 'unknown';
        statuses[s] = (statuses[s] || 0) + 1;
        if (app.appliedAt && app.updatedAt) {
            const diff = new Date(app.updatedAt) - new Date(app.appliedAt);
            if (!isNaN(diff) && diff >= 0) {
                totalTime += diff;
                timedCount++;
            }
        }
    });

    const hired = statuses.hired || 0;
    const rejected = statuses.rejected || 0;
    const pending = statuses.pending || 0;

    return {
        total,
        hired,
        rejected,
        pending,
        hireRate: total > 0 ? Math.round((hired / total) * 100) : 0,
        avgTimeToActionMs: timedCount > 0 ? Math.round(totalTime / timedCount) : null,
        statusBreakdown: statuses,
    };
}

/**
 * Build per-job analytics from a list of applications grouped by job.
 * #70 — Employer Analytics Dashboard
 */
function buildJobAnalytics(jobAppsMap = {}) {
    return Object.entries(jobAppsMap).map(([jobId, apps]) => {
        const summary = buildAnalyticsSummary(apps);
        return { jobId, ...summary };
    });
}

/**
 * Build premium applicant insights.
 * #71 — Premium Applicant Insights Pack
 */
function buildApplicantInsights(applications = []) {
    const total = applications.length;
    const withResume = applications.filter((a) => a.hasResume).length;
    const verified = applications.filter((a) => a.isVerified).length;
    const avgExp = total > 0
        ? Math.round(applications.reduce((s, a) => s + (Number(a.experienceYears) || 0), 0) / total * 10) / 10
        : 0;
    const topSkills = buildTopSkills(applications);
    const locationBreakdown = buildLocationBreakdown(applications);

    return {
        total,
        resumeAttachRate: total > 0 ? Math.round((withResume / total) * 100) : 0,
        verifiedRate: total > 0 ? Math.round((verified / total) * 100) : 0,
        avgExperienceYears: avgExp,
        topSkills,
        locationBreakdown,
    };
}

function buildTopSkills(applications) {
    const skillCount = {};
    applications.forEach((app) => {
        (app.skills || []).forEach((s) => {
            skillCount[s] = (skillCount[s] || 0) + 1;
        });
    });
    return Object.entries(skillCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([skill, count]) => ({ skill, count }));
}

function buildLocationBreakdown(applications) {
    const locCount = {};
    applications.forEach((app) => {
        const loc = String(app.location || 'Unknown');
        locCount[loc] = (locCount[loc] || 0) + 1;
    });
    return Object.entries(locCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([location, count]) => ({ location, count }));
}

module.exports = {
    buildAnalyticsSummary,
    buildJobAnalytics,
    buildApplicantInsights,
    buildTopSkills,
    buildLocationBreakdown,
};
