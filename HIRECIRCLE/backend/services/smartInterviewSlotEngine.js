const {
    ALL_SLOT_FIELDS,
    SLOT_TYPES,
    SLOT_ENUMS,
} = require('../config/smartInterviewSlotConfig');
const { getNextMissingSlot } = require('./smartInterviewGapDetector');
const { guardedGeminiGenerateText } = require('./aiGuardrailService');

const DEFAULT_MODEL = process.env.SMART_INTERVIEW_GEMINI_MODEL || process.env.AI_DEFAULT_MODEL || 'gemini-2.0-flash';
const AMBIGUOUS_CONFIDENCE_THRESHOLD = 0.6;
const MAX_SLOT_TEXT_LENGTH = Number.parseInt(process.env.SMART_INTERVIEW_SLOT_TEXT_MAX_CHARS || '160', 10);
const MAX_SLOT_ARRAY_ITEMS = Number.parseInt(process.env.SMART_INTERVIEW_SLOT_ARRAY_MAX_ITEMS || '25', 10);
const SHOULD_ALLOW_SECOND_PASS = String(
    process.env.SMART_INTERVIEW_ALLOW_SECOND_PASS
    || (String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'false' : 'true')
).toLowerCase() === 'true';

const AMBIGUOUS_TOKENS = [
    'some time',
    'not sure',
    'maybe',
    'around',
    'approximately',
    'few years',
    'as needed',
    'depends',
    'whatever',
    'anywhere',
];

const normalizeEvidenceText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeComparable = (value) => {
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeEvidenceText(item))
            .filter(Boolean)
            .sort()
            .join('|');
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        return String(Number(value));
    }
    return normalizeEvidenceText(value);
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPresent = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const sanitizeTextValue = (value, maxLength = MAX_SLOT_TEXT_LENGTH) => {
    const normalized = String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return null;
    return normalized.slice(0, Math.max(1, Number(maxLength) || MAX_SLOT_TEXT_LENGTH));
};

const normalizeEnumValue = (field, value) => {
    const normalized = sanitizeTextValue(value, 40)?.toLowerCase();
    if (!normalized) return null;

    if (field === 'shiftPreference') {
        if (normalized.includes('day')) return 'day';
        if (normalized.includes('night')) return 'night';
        if (normalized.includes('flex')) return 'flexible';
    }

    if (field === 'availabilityType') {
        if (normalized.includes('full')) return 'full-time';
        if (normalized.includes('part')) return 'part-time';
        if (normalized.includes('contract')) return 'contract';
    }

    return SLOT_ENUMS[field]?.includes(normalized) ? normalized : null;
};

const sanitizeFieldValue = (field, value) => {
    if (value === undefined || value === null) return null;
    const type = SLOT_TYPES[field];
    if (!type) return null;

    if (type === 'string') {
        return sanitizeTextValue(value);
    }

    if (type === 'number') {
        const normalized = Number(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(normalized) ? normalized : null;
    }

    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLowerCase();
        if (['yes', 'true', '1'].includes(normalized)) return true;
        if (['no', 'false', '0'].includes(normalized)) return false;
        return null;
    }

    if (type === 'string_array') {
        const items = Array.isArray(value)
            ? value
            : String(value || '')
                .split(',')
                .map((item) => item.trim());
        const normalized = items
            .slice(0, Math.max(1, Number(MAX_SLOT_ARRAY_ITEMS) || 25))
            .map((item) => sanitizeTextValue(item, 80))
            .filter(Boolean);
        return normalized;
    }

    if (type === 'enum') {
        return normalizeEnumValue(field, value);
    }

    return null;
};

const normalizeConfidence = (confidenceValue) => {
    const numeric = Number(confidenceValue);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric < 0) return 0;
    if (numeric > 1) return 1;
    return numeric;
};

const valueLooksAmbiguous = (value) => {
    if (!isPresent(value)) return false;
    const asText = Array.isArray(value) ? value.join(' ').toLowerCase() : String(value).toLowerCase();
    return AMBIGUOUS_TOKENS.some((token) => asText.includes(token));
};

const hasTranscriptEvidence = ({ field, value, transcript = '' }) => {
    const transcriptText = normalizeEvidenceText(transcript);
    if (!transcriptText) return false;

    if (value === null || value === undefined) return false;

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return false;
        const rounded = String(Math.round(value));
        return transcriptText.includes(rounded);
    }

    if (typeof value === 'boolean') {
        if (field === 'vehicleOwned') {
            if (value) return /\b(yes|own|have|vehicle|bike|car)\b/.test(transcriptText);
            return /\b(no|not|don'?t have|none)\b/.test(transcriptText);
        }
        return value
            ? /\b(yes|true)\b/.test(transcriptText)
            : /\b(no|false)\b/.test(transcriptText);
    }

    if (Array.isArray(value)) {
        if (!value.length) return false;
        return value.some((item) => hasTranscriptEvidence({ field, value: item, transcript }));
    }

    const normalizedValue = normalizeEvidenceText(value);
    if (!normalizedValue) return false;

    if (field === 'shiftPreference') {
        if (normalizedValue === 'day') return /\bday\b/.test(transcriptText);
        if (normalizedValue === 'night') return /\bnight\b/.test(transcriptText);
        if (normalizedValue === 'flexible') return /\bflex(ible)?\b/.test(transcriptText);
    }

    if (field === 'availabilityType') {
        if (normalizedValue === 'full-time') return /\bfull[\s-]?time\b/.test(transcriptText);
        if (normalizedValue === 'part-time') return /\bpart[\s-]?time\b/.test(transcriptText);
        if (normalizedValue === 'contract') return /\bcontract\b/.test(transcriptText);
    }

    if (transcriptText.includes(normalizedValue)) return true;
    const token = normalizedValue.split(' ').find((entry) => entry.length >= 4);
    if (!token) return false;
    return transcriptText.includes(token);
};

const buildPrompt = (transcript, existingSlotState = {}) => {
    return [
        'You are a deterministic slot extraction engine for hiring interviews.',
        'Extract values ONLY for the predefined schema below.',
        'If uncertain, set value to null and confidence <= 0.5.',
        'Never infer or invent values.',
        'Return strict JSON only. No markdown.',
        '',
        'Schema:',
        '{',
        '  "fullName": string|null,',
        '  "city": string|null,',
        '  "primaryRole": string|null,',
        '  "primarySkills": string[],',
        '  "totalExperienceYears": number|null,',
        '  "shiftPreference": string|null,',
        '  "expectedSalary": number|null,',
        '  "availabilityType": string|null,',
        '  "certifications": string[],',
        '  "languages": string[],',
        '  "vehicleOwned": boolean|null,',
        '  "licenseType": string|null,',
        '  "preferredWorkRadius": number|null,',
        '  "confidence": {',
        '    "fullName": number,',
        '    "city": number,',
        '    "primaryRole": number,',
        '    "primarySkills": number,',
        '    "totalExperienceYears": number,',
        '    "shiftPreference": number,',
        '    "expectedSalary": number,',
        '    "availabilityType": number,',
        '    "certifications": number,',
        '    "languages": number,',
        '    "vehicleOwned": number,',
        '    "licenseType": number,',
        '    "preferredWorkRadius": number',
        '  }',
        '}',
        '',
        `Existing slot state (confirmed data): ${JSON.stringify(existingSlotState)}`,
        `Transcript chunk: ${String(transcript || '').trim()}`,
    ].join('\n');
};

const parseGeminiJson = (rawText) => {
    const text = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    if (!text) throw new Error('Empty model response');

    try {
        return JSON.parse(text);
    } catch (error) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            throw new Error('Model response is not valid JSON object');
        }
        return JSON.parse(text.slice(start, end + 1));
    }
};

const callGemini = async ({ transcript, existingSlotState, retry = false }) => {
    const strictPrefix = retry
        ? 'STRICT RETRY: Return ONLY valid JSON. Do not include commentary.'
        : '';
    const prompt = [strictPrefix, buildPrompt(transcript, existingSlotState)].filter(Boolean).join('\n\n');
    const rawText = await guardedGeminiGenerateText({
        prompt,
        model: DEFAULT_MODEL,
        rateLimitKey: 'smart_interview_slot_extract',
        temperature: 0,
        maxOutputTokens: 800,
        timeoutMs: 8000,
    });
    return parseGeminiJson(rawText);
};

const normalizeExtractedPayload = (rawExtracted = {}) => {
    if (!isPlainObject(rawExtracted)) {
        throw new Error('Model response is not a valid JSON object');
    }

    const allowedTopLevel = new Set([...ALL_SLOT_FIELDS, 'confidence']);
    const unknownFields = Object.keys(rawExtracted).filter((field) => !allowedTopLevel.has(field));

    const normalized = {};
    for (const field of ALL_SLOT_FIELDS) {
        normalized[field] = sanitizeFieldValue(field, rawExtracted[field]);
    }

    const confidenceInput = isPlainObject(rawExtracted.confidence) ? rawExtracted.confidence : {};
    normalized.confidence = {};
    for (const field of ALL_SLOT_FIELDS) {
        normalized.confidence[field] = normalizeConfidence(confidenceInput[field]);
    }
    normalized.__unknownFields = unknownFields;

    return normalized;
};

const mergeSlots = ({ transcript = '', existingSlotState = {}, existingSlotConfidence = {}, extracted = {} }) => {
    const mergedState = { ...existingSlotState };
    const mergedConfidence = { ...existingSlotConfidence };
    const ambiguousFieldSet = new Set();
    const rejectedFields = [];
    const normalizedExtracted = normalizeExtractedPayload(extracted);
    const extractedConfidence = normalizedExtracted?.confidence || {};
    const unknownFields = Array.isArray(normalizedExtracted?.__unknownFields)
        ? normalizedExtracted.__unknownFields
        : [];
    if (unknownFields.length) {
        rejectedFields.push(...unknownFields);
    }

    for (const field of ALL_SLOT_FIELDS) {
        const rawValue = extracted[field];
        const sanitized = normalizedExtracted[field];
        const confidence = normalizeConfidence(extractedConfidence[field]);
        const currentValue = mergedState[field];
        const hasCurrentValue = isPresent(currentValue);
        const equalToCurrent = hasCurrentValue && normalizeComparable(currentValue) === normalizeComparable(sanitized);
        const evidenceSupported = hasTranscriptEvidence({ field, value: sanitized, transcript });
        const canApplyExtractedValue = isPresent(sanitized) && (equalToCurrent || evidenceSupported);
        const rawValuePresent = rawValue !== undefined && rawValue !== null;
        const rawValueMeaningful = Array.isArray(rawValue)
            ? rawValue.length > 0
            : (typeof rawValue === 'string'
                ? rawValue.trim().length > 0
                : rawValuePresent);
        const structurallyInvalidValue = rawValueMeaningful && !isPresent(sanitized);

        if (canApplyExtractedValue) {
            mergedState[field] = sanitized;
        } else if (isPresent(sanitized)) {
            ambiguousFieldSet.add(field);
            rejectedFields.push(field);
        } else if (structurallyInvalidValue) {
            ambiguousFieldSet.add(field);
            rejectedFields.push(field);
        }

        if (confidence > 0) {
            mergedConfidence[field] = canApplyExtractedValue ? confidence : Math.min(confidence, 0.35);
        } else if (!Number.isFinite(Number(mergedConfidence[field]))) {
            mergedConfidence[field] = 0;
        }

        const effectiveValue = mergedState[field];
        const effectiveConfidence = normalizeConfidence(mergedConfidence[field]);
        if (
            effectiveConfidence < AMBIGUOUS_CONFIDENCE_THRESHOLD ||
            (isPresent(effectiveValue) && valueLooksAmbiguous(effectiveValue))
        ) {
            ambiguousFieldSet.add(field);
        }
    }

    const missingSlot = getNextMissingSlot(mergedState, mergedConfidence);

    return {
        slotState: mergedState,
        slotConfidence: mergedConfidence,
        missingSlot,
        ambiguousFields: Array.from(ambiguousFieldSet),
        rejectedFields: Array.from(new Set(rejectedFields)),
        interviewComplete: !missingSlot,
    };
};

const extractSlotsFromTranscript = async (
    transcript,
    existingSlotState = {},
    existingSlotConfidence = {}
) => {
    let extracted;

    try {
        extracted = await callGemini({ transcript, existingSlotState });
    } catch (firstError) {
        if (!SHOULD_ALLOW_SECOND_PASS) {
            throw firstError;
        }
        extracted = await callGemini({ transcript, existingSlotState, retry: true });
    }

    return mergeSlots({
        transcript,
        existingSlotState,
        existingSlotConfidence,
        extracted,
    });
};

module.exports = {
    AMBIGUOUS_CONFIDENCE_THRESHOLD,
    hasTranscriptEvidence,
    normalizeExtractedPayload,
    extractSlotsFromTranscript,
    mergeSlots,
};
