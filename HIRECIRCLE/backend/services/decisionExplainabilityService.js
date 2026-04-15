const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const percent = (value) => `${Math.round(clamp01(value) * 100)}%`;

const explainMatchDecision = ({ explainability = {}, roleUsed = null } = {}) => {
    const skillScore = clamp01(explainability.skillScore ?? explainability.rawSkillScore ?? 0);
    const experienceScore = clamp01(explainability.experienceScore ?? 0);
    const distanceScore = clamp01(explainability.distanceScore ?? 0);
    const salaryScore = clamp01(explainability.salaryScore ?? explainability.salaryFitScore ?? 0);

    const reasons = [
        `Based on your skills (${percent(skillScore)}) and experience (${percent(experienceScore)}).`,
        `Location fit contributed ${percent(distanceScore)} with salary alignment at ${percent(salaryScore)}.`,
    ];

    if (roleUsed) {
        reasons.unshift(`Why this matches you: your ${roleUsed} profile aligns with this role.`);
    } else {
        reasons.unshift('Why this matches you: your profile aligns with this role.');
    }

    return {
        reasons,
        summary: reasons.join(' '),
    };
};

const explainRankingDecision = ({ explainability = {}, context = 'ranking' } = {}) => {
    const skillScore = clamp01(explainability.skillScore ?? 0);
    const experienceScore = clamp01(explainability.experienceScore ?? 0);
    const distanceScore = clamp01(explainability.distanceScore ?? 0);

    return {
        label: context,
        summary: `Based on your skills + experience + location (${percent(skillScore)}, ${percent(experienceScore)}, ${percent(distanceScore)}).`,
        factors: {
            skillScore: Number(skillScore.toFixed(4)),
            experienceScore: Number(experienceScore.toFixed(4)),
            locationScore: Number(distanceScore.toFixed(4)),
        },
    };
};

module.exports = {
    explainMatchDecision,
    explainRankingDecision,
};
