const clamp01 = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;

    const normalized = parsed > 1 ? parsed / 100 : parsed;
    if (!Number.isFinite(normalized)) return fallback;
    return Math.max(0, Math.min(1, normalized));
};

const getMatchQualityTargets = () => ({
    interviewRateTarget: clamp01(process.env.MATCH_TARGET_INTERVIEW_RATE, 0.10),
    postInterviewHireRateTarget: clamp01(process.env.MATCH_TARGET_POST_INTERVIEW_HIRE_RATE, 0.35),
    offerAcceptanceTarget: clamp01(process.env.MATCH_TARGET_OFFER_ACCEPTANCE_RATE, 0.78),
    rollingWindowDays: Number.parseInt(process.env.MATCH_TARGET_WINDOW_DAYS || '7', 10),
    minimumSampleSize: Number.parseInt(process.env.MATCH_TARGET_MIN_SAMPLE_SIZE || '20', 10),
    retrainSignificantGap: clamp01(process.env.MATCH_TARGET_RETRAIN_GAP, 0.15),
});

module.exports = {
    getMatchQualityTargets,
};
