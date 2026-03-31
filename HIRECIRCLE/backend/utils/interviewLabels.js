const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
};

const toProfileStrengthLabel = (score) => {
    const normalized = clamp01(score);
    if (normalized >= 0.75) return 'Strong';
    if (normalized >= 0.5) return 'Good';
    return 'Weak';
};

const toCommunicationLabel = (score) => {
    const normalized = clamp01(score);
    if (normalized >= 0.8) return 'Clear';
    if (normalized >= 0.6) return 'Good';
    return 'Improving';
};

const toSalaryAlignmentStatus = (salaryOutlierFlag) => {
    return salaryOutlierFlag ? 'OUTLIER' : 'ALIGNED';
};

module.exports = {
    toProfileStrengthLabel,
    toCommunicationLabel,
    toSalaryAlignmentStatus,
};
