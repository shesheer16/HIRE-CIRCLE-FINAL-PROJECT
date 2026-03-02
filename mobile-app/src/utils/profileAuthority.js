const clamp = (value, min = 0, max = 100) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.max(min, Math.min(max, numeric));
};

export const calculateCompletionPercent = (profile = {}) => {
    const fields = [
        Boolean(String(profile?.name || '').trim()),
        Boolean(String(profile?.roleTitle || '').trim()),
        Boolean(String(profile?.location || '').trim()),
        Boolean(String(profile?.summary || '').trim()),
        Array.isArray(profile?.skills) && profile.skills.length > 0,
        Array.isArray(profile?.qualifications) && profile.qualifications.length > 0,
    ];

    const filledCount = fields.filter(Boolean).length;
    return Math.round((filledCount / fields.length) * 100);
};

export const buildVerificationState = (rawProfile = {}, profile = {}, user = {}) => {
    const emailVerified = Boolean(
        rawProfile?.emailVerified
        || rawProfile?.isEmailVerified
        || user?.emailVerified
        || user?.isEmailVerified
    );

    const phoneVerified = Boolean(
        rawProfile?.phoneVerified
        || rawProfile?.isPhoneVerified
        || user?.phoneVerified
        || user?.isPhoneVerified
        || user?.isOTPVerified
    );

    const interviewVerified = Boolean(
        rawProfile?.interviewVerified
        || rawProfile?.smartInterviewVerified
        || profile?.interviewVerified
    );

    const identityVerified = Boolean(
        rawProfile?.kycVerified
        || rawProfile?.isKycVerified
        || rawProfile?.governmentIdVerified
    );

    return {
        emailVerified,
        phoneVerified,
        interviewVerified,
        identityVerified,
    };
};

export const buildSkillStrengths = (skills = [], experienceYears = 0) => {
    const safeSkills = Array.isArray(skills) ? skills.slice(0, 4) : [];
    const expBoost = clamp((Number(experienceYears) || 0) * 4, 0, 28);

    return safeSkills.map((skill, index) => {
        const textWeight = clamp(String(skill || '').length * 1.8, 0, 22);
        const orderModifier = Math.max(0, 10 - (index * 2));
        const strength = clamp(42 + expBoost + textWeight + orderModifier);

        return {
            label: String(skill || 'Skill'),
            value: strength,
        };
    });
};

export const buildAuthorityMetrics = ({
    profile = {},
    rawProfile = {},
    user = {},
    activityCount = 0,
}) => {
    const authority = rawProfile?.trustAuthority || rawProfile?.authority || null;
    const hasAuthoritySnapshot = Boolean(authority && typeof authority === 'object');
    const completionPercent = calculateCompletionPercent(profile);

    const completionWeight = Math.round(clamp(completionPercent * 0.45));
    const interviewConfidence = Math.round(clamp(
        profile?.interviewVerified
            ? Math.max(62, completionPercent * 0.7)
            : completionPercent * 0.42,
        0,
        35,
    ));
    const activityWeight = Math.round(clamp(activityCount * 4, 0, 25));

    // Required deterministic formula.
    const profileScore = clamp(completionWeight + interviewConfidence + activityWeight);

    const verificationState = buildVerificationState(rawProfile, profile, user);
    const verifiedCount = Object.values(verificationState).filter(Boolean).length;
    const fallbackTrustScore = clamp(Math.round((profileScore * 0.82) + (verifiedCount * 4.5)));
    const trustScore = hasAuthoritySnapshot
        ? clamp(authority?.trustScore, 0, 100)
        : fallbackTrustScore;

    const interviewBadge = profile?.interviewVerified
        ? (interviewConfidence >= 30 ? 'High Confidence' : 'Verified')
        : 'Interview Pending';

    const completionRate = hasAuthoritySnapshot
        ? clamp(authority?.completionRate, 0, 100)
        : completionPercent;
    const endorsements = hasAuthoritySnapshot
        ? Math.max(0, Number(authority?.endorsements || 0))
        : verifiedCount;
    const verifiedHires = hasAuthoritySnapshot
        ? Math.max(0, Number(authority?.verifiedHires || 0))
        : 0;
    const authorityRank = hasAuthoritySnapshot
        ? authority?.authorityRank || { region: 'global', rank: null, percentile: null }
        : { region: 'global', rank: null, percentile: null };
    const communityInfluence = hasAuthoritySnapshot
        ? clamp(authority?.communityInfluence, 0, 100)
        : clamp((activityCount * 6) + (verifiedCount * 4), 0, 100);
    const hireSuccessScore = hasAuthoritySnapshot
        ? clamp(authority?.hireSuccessScore, 0, 100)
        : clamp(profileScore * 0.75, 0, 100);
    const responseScore = hasAuthoritySnapshot
        ? clamp(authority?.responseScore, 0, 100)
        : clamp(100 - (Math.max(0, 24 - activityCount) * 2), 0, 100);

    return {
        completionPercent,
        completionRate,
        completionWeight,
        interviewConfidence,
        activityWeight,
        profileScore,
        trustScore,
        activityScore: clamp(activityCount * 10, 0, 100),
        endorsements,
        verifiedHires,
        authorityRank,
        communityInfluence,
        hireSuccessScore,
        responseScore,
        verificationState,
        interviewBadge,
        skillStrengths: buildSkillStrengths(profile?.skills || [], profile?.experienceYears || 0),
        trustExplanation: hasAuthoritySnapshot ? authority?.explanation || null : null,
        badges: hasAuthoritySnapshot ? authority?.badges || [] : [],
    };
};
