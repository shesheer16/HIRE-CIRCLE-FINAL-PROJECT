const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
};

const resolvedThreshold = clamp01(process.env.MATCH_THRESHOLD);

const settings = Object.freeze({
    MATCH_THRESHOLD: resolvedThreshold !== null ? resolvedThreshold : 0.62,
});

module.exports = settings;

