'use strict';
/**
 * matchExplainabilityService.js
 * Feature #48/#100 — Dynamic AI Match % Explanations + Explainable AI UI
 *
 * Generates human-readable explanations for why a job matched a worker
 * (or why they scored a given match %).
 * Deterministic — same inputs always produce same output.
 */

const SKILL_WEIGHT = 0.40;
const LOCATION_WEIGHT = 0.25;
const EXPERIENCE_WEIGHT = 0.20;
const AVAILABILITY_WEIGHT = 0.10;
const BADGE_WEIGHT = 0.05;

/**
 * Compute match dimension breakdown
 * @param {object} workerProfile - WorkerProfile lean doc
 * @param {object} job - Job lean doc
 * @param {number} overallScore - precomputed 0-100 match score
 * @returns {object} explanation
 */
function explainMatch(workerProfile, job, overallScore) {
    const score = Number(overallScore) || 0;

    // Skill match
    const workerSkills = (workerProfile?.skills || []).map((s) => String(s).toLowerCase().trim());
    const jobSkills = (job?.skills || []).map((s) => String(s).toLowerCase().trim());
    const matchedSkills = workerSkills.filter((s) => jobSkills.includes(s));
    const skillScore = jobSkills.length > 0
        ? Math.round((matchedSkills.length / jobSkills.length) * 100)
        : 100;

    // Location match
    const workerCity = String(workerProfile?.location || '').toLowerCase().trim();
    const jobCity = String(job?.location || '').toLowerCase().trim();
    const locationScore = (workerCity && jobCity && workerCity === jobCity) ? 100
        : (workerCity && jobCity && jobCity.includes(workerCity)) ? 70 : 40;

    // Experience match
    const workerExp = Number(workerProfile?.experienceYears || 0);
    const jobMinExp = Number(job?.minExperienceYears || 0);
    const jobMaxExp = Number(job?.maxExperienceYears || 99);
    let expScore = 100;
    if (workerExp < jobMinExp) expScore = Math.max(20, Math.round(100 - (jobMinExp - workerExp) * 10));
    else if (workerExp > jobMaxExp + 5) expScore = 80; // overqualified signal

    // Availability match
    const workerAvail = String(workerProfile?.availability || 'full_time').toLowerCase();
    const jobType = String(job?.jobType || 'full_time').toLowerCase();
    const availScore = workerAvail === jobType || jobType === 'any' ? 100 : 50;

    // Badge score
    const badgeCount = Number(workerProfile?.badgeCount || 0);
    const badgeScore = Math.min(100, badgeCount * 20);

    // Weighted composite
    const weighted = Math.round(
        skillScore * SKILL_WEIGHT +
        locationScore * LOCATION_WEIGHT +
        expScore * EXPERIENCE_WEIGHT +
        availScore * AVAILABILITY_WEIGHT +
        badgeScore * BADGE_WEIGHT
    );

    // Statement labels
    const positives = [];
    const gaps = [];

    if (skillScore >= 80) positives.push(`Strong skill match: ${matchedSkills.slice(0, 3).join(', ')}`);
    else if (skillScore >= 50) positives.push(`Partial skill match (${matchedSkills.length}/${jobSkills.length} skills)`);
    else gaps.push(`Skills gap: missing ${jobSkills.filter((s) => !workerSkills.includes(s)).slice(0, 3).join(', ')}`);

    if (locationScore === 100) positives.push('Exact location match');
    else if (locationScore === 70) positives.push('Near location');
    else gaps.push('Location does not match — consider remote options');

    if (expScore === 100) positives.push('Experience perfectly aligned');
    else if (expScore >= 70) positives.push('Experience close to required range');
    else gaps.push(`Experience gap: ${workerExp}y vs ${jobMinExp}-${jobMaxExp}y required`);

    if (availScore === 100) positives.push('Availability matches job type');
    else gaps.push(`Availability mismatch: you are ${workerAvail}, job is ${jobType}`);

    if (badgeScore >= 60) positives.push(`${badgeCount} verified badge${badgeCount !== 1 ? 's' : ''}`);

    return {
        overallScore: score,
        weightedEstimate: weighted,
        dimensions: {
            skills: { score: skillScore, weight: `${Math.round(SKILL_WEIGHT * 100)}%`, matchedSkills, totalJobSkills: jobSkills.length },
            location: { score: locationScore, weight: `${Math.round(LOCATION_WEIGHT * 100)}%` },
            experience: { score: expScore, weight: `${Math.round(EXPERIENCE_WEIGHT * 100)}%` },
            availability: { score: availScore, weight: `${Math.round(AVAILABILITY_WEIGHT * 100)}%` },
            badges: { score: badgeScore, weight: `${Math.round(BADGE_WEIGHT * 100)}%` },
        },
        positives,
        gaps,
        summary: positives.length > gaps.length
            ? `Strong match — ${positives[0]}.`
            : `${Math.max(0, 100 - weighted)}% of requirements need attention.`,
    };
}

/**
 * Feature #97 — Rejection Transparency Panel
 * Generates an honest, human-readable explanation for why a candidate
 * was not shortlisted or rejected from a job application.
 *
 * Uses existing application + worker + job fields — no new schema.
 * Deterministic: same inputs → same output.
 *
 * @param {object} workerProfile - skills, experienceYears, location, availability
 * @param {object} job - skills, minExperienceYears, location, jobType
 * @param {string} rejectionReason - raw rejection code from application state machine
 * @returns {{ primaryReason: string, supportingReasons: string[], improvementTips: string[], isAutomated: boolean }}
 */
function explainRejection(workerProfile, job, rejectionReason = '') {
    const worker = workerProfile || {};
    const j = job || {};

    // Map raw rejection codes to friendly messages
    const REJECTION_CODE_MAP = {
        employer_rejected: 'The employer reviewed your profile and selected another candidate.',
        not_shortlisted: 'Your profile did not meet the shortlisting criteria for this role.',
        skill_mismatch: 'Your listed skills did not match the key requirements for this job.',
        experience_insufficient: 'The required experience level was higher than your current experience.',
        location_mismatch: 'The job location does not match your listed location.',
        profile_incomplete: 'Your profile was incomplete at the time of application.',
        salary_mismatch: 'Salary expectations did not align with the job offer.',
        position_filled: 'This position was filled before your application could be reviewed.',
        no_response: 'The employer did not respond within the offer window.',
    };

    const primaryReason = REJECTION_CODE_MAP[rejectionReason]
        || 'The employer selected a candidate who was a better fit for this role.';

    const supportingReasons = [];
    const improvementTips = [];

    // Skill analysis
    const workerSkills = (worker.skills || []).map((s) => String(s).toLowerCase().trim());
    const jobSkills = (j.skills || []).map((s) => String(s).toLowerCase().trim());
    const missingSkills = jobSkills.filter((s) => !workerSkills.includes(s));
    if (missingSkills.length > 0) {
        supportingReasons.push(`Missing skills: ${missingSkills.slice(0, 3).join(', ')}`);
        improvementTips.push(`Add these skills to your profile: ${missingSkills.slice(0, 3).join(', ')}`);
    }

    // Experience analysis
    const workerExp = Number(worker.experienceYears || 0);
    const jobMinExp = Number(j.minExperienceYears || 0);
    if (workerExp < jobMinExp) {
        supportingReasons.push(`Experience below requirement (${workerExp}y vs ${jobMinExp}y minimum)`);
        improvementTips.push(`Gain ${jobMinExp - workerExp} more year(s) of relevant experience`);
    }

    // Location analysis
    const workerCity = String(worker.location || '').toLowerCase().trim();
    const jobCity = String(j.location || '').toLowerCase().trim();
    if (workerCity && jobCity && !jobCity.includes(workerCity) && !workerCity.includes(jobCity)) {
        supportingReasons.push('Location does not match the job listing');
        improvementTips.push('Update your location or search for remote-eligible positions');
    }

    // Profile completeness
    const hasPhoto = !!worker.avatarUrl;
    const hasBio = (String(worker.bio || '')).trim().length > 20;
    if (!hasPhoto) improvementTips.push('Add a professional profile photo');
    if (!hasBio) improvementTips.push('Write a short bio highlighting your strengths');

    return {
        primaryReason,
        supportingReasons,
        improvementTips,
        isAutomated: !['employer_rejected', 'salary_mismatch'].includes(rejectionReason),
        matchScore: explainMatch(workerProfile, job, 0).weightedEstimate,
    };
}

module.exports = { explainMatch, explainRejection };
