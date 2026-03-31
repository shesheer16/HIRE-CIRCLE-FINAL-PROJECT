const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
};

const FILLER_WORDS = new Set([
    'um',
    'uh',
    'hmm',
    'like',
    'basically',
    'actually',
    'literally',
]);

const HESITATION_PATTERNS = [
    /\bi\s+think\b/gi,
    /\bnot\s+sure\b/gi,
    /\bmaybe\b/gi,
    /\bkind\s+of\b/gi,
    /\bsort\s+of\b/gi,
    /\bprobably\b/gi,
];

const DECISIVE_PATTERNS = [
    /\bi\s+have\b/gi,
    /\bi\s+worked\b/gi,
    /\bi\s+can\b/gi,
    /\bi\s+am\b/gi,
    /\bi\s+prefer\b/gi,
    /\bexactly\b/gi,
    /\bdefinitely\b/gi,
];

const splitSentences = (text = '') => {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/[.!?]+/)
        .map((item) => item.trim())
        .filter(Boolean);
};

const tokenizeWords = (text = '') => {
    return String(text || '')
        .toLowerCase()
        .match(/[a-z0-9']+/g) || [];
};

const countPatternHits = (text = '', patterns = []) => {
    return patterns.reduce((sum, regex) => {
        const matches = String(text || '').match(regex);
        return sum + (matches ? matches.length : 0);
    }, 0);
};

const deriveCommunicationMetrics = (transcript = '') => {
    const normalizedTranscript = String(transcript || '').replace(/\s+/g, ' ').trim();
    if (!normalizedTranscript) {
        return {
            transcriptLength: 0,
            sentenceCount: 0,
            averageSentenceLength: 0,
            fillerWordFrequency: 0,
            hesitationMarkerRate: 0,
            communicationClarityScore: 0,
            confidenceLanguageScore: 0,
        };
    }

    const sentences = splitSentences(normalizedTranscript);
    const words = tokenizeWords(normalizedTranscript);
    const totalWords = words.length;

    const fillerCount = words.reduce((sum, word) => sum + (FILLER_WORDS.has(word) ? 1 : 0), 0);
    const hesitationCount = countPatternHits(normalizedTranscript, HESITATION_PATTERNS);
    const decisiveCount = countPatternHits(normalizedTranscript, DECISIVE_PATTERNS);

    const averageSentenceLength = sentences.length
        ? totalWords / Math.max(sentences.length, 1)
        : totalWords;
    const fillerWordFrequency = totalWords > 0 ? fillerCount / totalWords : 0;
    const hesitationMarkerRate = sentences.length > 0 ? hesitationCount / sentences.length : 0;

    const sentenceLengthScore = clamp01(1 - Math.abs(averageSentenceLength - 13) / 18);
    const fillerPenalty = clamp01(fillerWordFrequency * 5.5);
    const hesitationPenalty = clamp01(hesitationMarkerRate * 0.55);
    const communicationClarityScore = clamp01(
        (sentenceLengthScore * 0.45)
        + ((1 - fillerPenalty) * 0.35)
        + ((1 - hesitationPenalty) * 0.20)
    );

    const confidenceLanguageScore = clamp01(
        (decisiveCount + 1) / (decisiveCount + hesitationCount + 2)
    );

    return {
        transcriptLength: normalizedTranscript.length,
        sentenceCount: sentences.length,
        averageSentenceLength: Number(averageSentenceLength.toFixed(4)),
        fillerWordFrequency: Number(fillerWordFrequency.toFixed(4)),
        hesitationMarkerRate: Number(hesitationMarkerRate.toFixed(4)),
        communicationClarityScore: Number(communicationClarityScore.toFixed(4)),
        confidenceLanguageScore: Number(confidenceLanguageScore.toFixed(4)),
    };
};

const mergeCommunicationMetrics = (previous = {}, next = {}) => {
    const previousTurns = Number(previous.samples || 0);
    const nextTurns = Number(next.samples || 1);
    const total = previousTurns + nextTurns;
    if (total <= 0) return next;

    const weighted = (prev, curr) => Number((((prev * previousTurns) + (curr * nextTurns)) / total).toFixed(4));

    return {
        samples: total,
        sentenceCount: weighted(Number(previous.sentenceCount || 0), Number(next.sentenceCount || 0)),
        averageSentenceLength: weighted(Number(previous.averageSentenceLength || 0), Number(next.averageSentenceLength || 0)),
        fillerWordFrequency: weighted(Number(previous.fillerWordFrequency || 0), Number(next.fillerWordFrequency || 0)),
        hesitationMarkerRate: weighted(Number(previous.hesitationMarkerRate || 0), Number(next.hesitationMarkerRate || 0)),
        communicationClarityScore: weighted(Number(previous.communicationClarityScore || 0), Number(next.communicationClarityScore || 0)),
        confidenceLanguageScore: weighted(Number(previous.confidenceLanguageScore || 0), Number(next.confidenceLanguageScore || 0)),
    };
};

const toCommunicationClarityTag = (score) => {
    const normalized = clamp01(score);
    if (normalized >= 0.8) return 'Clear';
    if (normalized >= 0.6) return 'Good';
    return 'Needs Review';
};

module.exports = {
    deriveCommunicationMetrics,
    mergeCommunicationMetrics,
    toCommunicationClarityTag,
};
