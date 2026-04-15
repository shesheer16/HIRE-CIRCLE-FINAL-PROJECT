const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const toRecommendation = (matchPercentage) => {
    const score = Number(matchPercentage || 0);
    if (score >= 85) return 'shortlist';
    if (score >= 60) return 'review';
    return 'reject';
};

const normalizeList = (value) => (
    Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : []
);

const buildAiCandidateInsight = ({
    matchPercentage = 0,
    explanation = {},
    workerProfile = null,
    job = null,
} = {}) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number(matchPercentage || 0))));
    const positives = normalizeList(explanation?.positives);
    const gaps = normalizeList(explanation?.gaps);

    const strengths = positives.slice(0, 4);
    const risks = gaps.slice(0, 4);
    const roleName = String(workerProfile?.roleProfiles?.find((row) => row?.activeProfile)?.roleName || workerProfile?.roleProfiles?.[0]?.roleName || '').trim();
    const jobTitle = String(job?.title || '').trim();

    const fitSummary = percent >= 85
        ? `Strong fit for ${jobTitle || 'this job'} based on current profile signal quality.`
        : percent >= 60
            ? `Potential fit for ${jobTitle || 'this job'}; review highlighted gaps before shortlisting.`
            : `Low fit confidence for ${jobTitle || 'this job'} with current profile coverage.`;

    return {
        fit_summary: fitSummary,
        strengths,
        risks,
        recommendation: toRecommendation(percent),
        confidence_score: Number(clamp01(percent / 100).toFixed(4)),
        metadata: {
            match_percentage: percent,
            active_role: roleName || null,
            target_job: jobTitle || null,
        },
    };
};

module.exports = {
    buildAiCandidateInsight,
};

