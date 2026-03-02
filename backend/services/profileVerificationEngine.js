/**
 * profileVerificationEngine — Multi-layer badge and tier computation.
 *
 * Badge tiers: Bronze → Silver → Gold → Verified Pro
 *
 * Rules:
 *  - Deterministic: same inputs → same output
 *  - No frontend override possible
 *  - No manual spoofing (all inputs come from server-side verified fields)
 */
'use strict';

// Tier thresholds (points)
const TIER_THRESHOLDS = {
    'Verified Pro': 90,
    Gold: 70,
    Silver: 45,
    Bronze: 10,
};

/**
 * Compute verification points for a user profile.
 * @param {object} user — Mongoose User doc (plain object)
 * @param {object} workerProfile — WorkerProfile doc (plain object, nullable)
 * @param {object} employerProfile — EmployerProfile doc (plain object, nullable)
 * @returns {object} { tier, points, badges, badgeDetails }
 */
function computeVerificationProfile(user = {}, workerProfile = null, employerProfile = null) {
    let points = 0;
    const badges = [];
    const badgeDetails = [];

    // --- Identity Layer ---
    if (user.phoneVerified === true || user.mobileVerified === true) {
        points += 20;
        badges.push('phone_verified');
        badgeDetails.push({ id: 'phone_verified', label: 'Phone Verified', icon: '📱', description: 'OTP-confirmed phone number' });
    }
    if (user.emailVerified === true) {
        points += 15;
        badges.push('email_verified');
        badgeDetails.push({ id: 'email_verified', label: 'Email Verified', icon: '✉️', description: 'Verified email address' });
    }
    if (user.govIdVerified === true) {
        points += 25;
        badges.push('gov_id_verified');
        badgeDetails.push({ id: 'gov_id_verified', label: 'ID Verified', icon: '🪪', description: 'Government ID confirmed' });
    }
    if (user.faceMatchVerified === true) {
        points += 15;
        badges.push('face_verified');
        badgeDetails.push({ id: 'face_verified', label: 'Face Match', icon: '🤳', description: 'Biometric face match confirmed' });
    }

    // --- Worker-specific badges ---
    if (workerProfile) {
        const hasCompletedInterview = Boolean(
            workerProfile.smartInterviewCompleted ||
            workerProfile.interviewScore > 0 ||
            workerProfile.videoIntroduction?.transcript
        );
        if (hasCompletedInterview) {
            points += 20;
            badges.push('interview_verified');
            badgeDetails.push({ id: 'interview_verified', label: 'Interview Verified', icon: '🎤', description: 'Smart Interview completed and scored' });
        }

        const skillCount = (workerProfile.skills || []).length;
        if (skillCount >= 3) {
            points += 10;
            badges.push('skill_verified');
            badgeDetails.push({ id: 'skill_verified', label: 'Skills Verified', icon: '⚡', description: '3+ skills listed and validated' });
        }
    }

    // --- Employer-specific badges ---
    if (employerProfile) {
        if (employerProfile.gstVerified === true || employerProfile.businessIdVerified === true) {
            points += 20;
            badges.push('business_verified');
            badgeDetails.push({ id: 'business_verified', label: 'Business Verified', icon: '🏢', description: 'GST/Business ID confirmed' });
        }
        if (employerProfile.companyEmailVerified === true) {
            points += 10;
            badges.push('company_email_verified');
            badgeDetails.push({ id: 'company_email_verified', label: 'Company Email', icon: '📧', description: 'Company email domain verified' });
        }
        if (employerProfile.officeLocationVerified === true) {
            points += 10;
            badges.push('location_verified');
            badgeDetails.push({ id: 'location_verified', label: 'Office Verified', icon: '📍', description: 'Office location confirmed' });
        }
        if ((employerProfile.totalHires || 0) >= 5) {
            points += 15;
            badges.push('hiring_history_verified');
            badgeDetails.push({ id: 'hiring_history_verified', label: 'Active Hirer', icon: '✅', description: 'Proven hiring history (5+ hires)' });
        }
    }

    // Compute tier
    let tier = null;
    for (const [tierName, threshold] of Object.entries(TIER_THRESHOLDS)) {
        if (points >= threshold) {
            tier = tierName;
            break;
        }
    }

    return {
        tier,
        points,
        badges,
        badgeDetails,
        tierTooltip: tier
            ? `${tier} — Earned with ${points} verification points`
            : `No tier yet — Complete verification steps to earn your badge`,
    };
}

/**
 * Get the tier for a given points score (used in tests + display).
 */
function getTierForPoints(points) {
    for (const [tierName, threshold] of Object.entries(TIER_THRESHOLDS)) {
        if (points >= threshold) return tierName;
    }
    return null;
}

module.exports = {
    computeVerificationProfile,
    getTierForPoints,
    TIER_THRESHOLDS,
};
