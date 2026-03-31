const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const InterviewQualityScore = require('../models/InterviewQualityScore');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const normalizeSections = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 20);
};

const evaluateQuality = ({
    clarityScore,
    confidenceScore,
    completenessScore,
    ambiguityCount,
    retryCount,
    missingSections,
}) => {
    const clarity = clamp01(clarityScore);
    const confidence = clamp01(confidenceScore);
    const completeness = clamp01(completenessScore);
    const ambiguityPenalty = clamp(ambiguityCount / 8, 0, 0.4);
    const retryPenalty = clamp(retryCount / 10, 0, 0.3);

    const overall = clamp01(
        (clarity * 0.35)
        + (confidence * 0.25)
        + (completeness * 0.4)
        - ambiguityPenalty
        - retryPenalty
    );

    const recommendations = [];
    if (overall < 0.55) {
        recommendations.push('suggest_retake');
    }
    if (clarity < 0.6 || ambiguityCount >= 3) {
        recommendations.push('suggest_clarification');
    }
    if (completeness < 0.7 || missingSections.length > 0) {
        recommendations.push('highlight_missing_sections');
    }

    return {
        overallQualityScore: Number(overall.toFixed(4)),
        recommendations,
    };
};

const resolveSourceData = async ({ processingId = null, payload = {} }) => {
    if (payload && Object.keys(payload).length > 0) {
        return {
            source: 'payload',
            processingJob: null,
            clarityScore: payload.clarityScore,
            confidenceScore: payload.confidenceScore,
            completenessScore: payload.completenessScore,
            ambiguityCount: payload.ambiguityCount,
            retryCount: payload.retryCount,
            missingSections: payload.missingSections,
            userId: payload.userId,
            jobId: payload.jobId,
        };
    }

    if (!processingId) {
        throw new Error('processingId or payload is required for interview quality evaluation');
    }

    const processingJob = await InterviewProcessingJob.findById(processingId)
        .select('userId createdJobId rawMetrics ambiguousFields clarificationTriggeredCount clarificationSkippedCount')
        .lean();

    if (!processingJob) {
        throw new Error('Interview processing job not found for quality evaluation');
    }

    const raw = processingJob.rawMetrics || {};

    return {
        source: 'processing_job',
        processingJob,
        clarityScore: raw.communicationClarityScore,
        confidenceScore: raw.confidenceLanguageScore ?? raw.confidenceScore,
        completenessScore: raw.slotCompletenessRatio,
        ambiguityCount: Array.isArray(processingJob.ambiguousFields) ? processingJob.ambiguousFields.length : 0,
        retryCount: Number(processingJob.clarificationTriggeredCount || 0) + Number(processingJob.clarificationSkippedCount || 0),
        missingSections: Array.isArray(processingJob.ambiguousFields) ? processingJob.ambiguousFields : [],
        userId: processingJob.userId,
        jobId: processingJob.createdJobId,
    };
};

const scoreInterviewQuality = async ({
    processingId = null,
    payload = {},
    upsert = true,
}) => {
    const source = await resolveSourceData({ processingId, payload });

    const clarityScore = clamp01(source.clarityScore ?? 0);
    const confidenceScore = clamp01(source.confidenceScore ?? 0);
    const completenessScore = clamp01(source.completenessScore ?? 0);
    const ambiguityCount = Math.max(0, Number(source.ambiguityCount || 0));
    const retryCount = Math.max(0, Number(source.retryCount || 0));
    const missingSections = normalizeSections(source.missingSections || []);

    const evaluated = evaluateQuality({
        clarityScore,
        confidenceScore,
        completenessScore,
        ambiguityCount,
        retryCount,
        missingSections,
    });

    const output = {
        userId: source.userId,
        processingId: source.processingJob?._id || processingId || null,
        jobId: source.jobId || null,
        clarityScore: Number(clarityScore.toFixed(4)),
        confidenceScore: Number(confidenceScore.toFixed(4)),
        completenessScore: Number(completenessScore.toFixed(4)),
        ambiguityCount,
        retryCount,
        overallQualityScore: evaluated.overallQualityScore,
        recommendations: evaluated.recommendations,
        missingSections,
    };

    if (!upsert) return output;
    if (!output.userId) {
        throw new Error('userId required to persist interview quality score');
    }

    const persisted = await InterviewQualityScore.findOneAndUpdate(
        {
            userId: output.userId,
            processingId: output.processingId || null,
        },
        {
            $set: output,
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return persisted;
};

module.exports = {
    scoreInterviewQuality,
    evaluateQuality,
};
