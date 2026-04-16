const axios = require('axios');
const fs = require('fs');

const logger = require('../utils/logger');
const { appendSmartInterviewTraceSyncSafe } = require('./smartInterviewTraceService');
const { resolveRoutingContext } = require('./regionRoutingService');
const {
    recordAiUsage,
    assertAiBudget,
    detectHighFrequencyAbuse,
    executeSmartBatch,
    estimateTokensFromText,
} = require('./aiCostOptimizationService');

const DEFAULT_MODEL_CHAIN = String(
    process.env.AI_MODEL_CHAIN
    || 'gemini-2.5-flash,gemini-2.5-pro,gemini-2.0-flash-lite'
)
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const readApiKey = () => {
    const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const looksPlaceholder = (
        key.startsWith('<')
        || key.endsWith('>')
        || key.toLowerCase().includes('gemini')
        || key.toLowerCase().includes('your_real_key')
        || key.length < 24
    );
    if (!key || looksPlaceholder) {
        const error = new Error('GEMINI_API_KEY_NOT_CONFIGURED');
        error.code = 'GEMINI_API_KEY_NOT_CONFIGURED';
        throw error;
    }
    process.env.GEMINI_API_KEY = key;
    if (!String(process.env.GOOGLE_API_KEY || '').trim()) {
        process.env.GOOGLE_API_KEY = key;
    }
    return key;
};

const normalizeModel = (model) => String(model || '').trim();

const resolveModelChain = (preferredModel = null) => {
    const preferred = normalizeModel(preferredModel);
    if (!preferred) return DEFAULT_MODEL_CHAIN;

    return Array.from(new Set([preferred, ...DEFAULT_MODEL_CHAIN]));
};

const resolveModelChainOverride = (overrideValue = null, fallbackPreferredModel = null) => {
    if (Array.isArray(overrideValue) && overrideValue.length) {
        return overrideValue
            .map((value) => normalizeModel(value))
            .filter(Boolean);
    }

    if (typeof overrideValue === 'string' && overrideValue.trim()) {
        const parsed = overrideValue
            .split(',')
            .map((value) => normalizeModel(value))
            .filter(Boolean);
        if (parsed.length) return parsed;
    }

    return resolveModelChain(fallbackPreferredModel);
};

const toOptionalInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const buildGeminiUrl = ({ model }) => {
    const apiKey = readApiKey();
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
};

const extractCandidateText = (responseData) => String(responseData?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

const parseStrictJson = (text) => {
    const normalized = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    if (!normalized) throw new Error('AI returned empty response');

    try {
        return JSON.parse(normalized);
    } catch (_error) {
        const startIdx = normalized.indexOf('{');
        const endIdx = normalized.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            return JSON.parse(normalized.slice(startIdx, endIdx + 1));
        }

        const arrayStart = normalized.indexOf('[');
        const arrayEnd = normalized.lastIndexOf(']');
        if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
            return JSON.parse(normalized.slice(arrayStart, arrayEnd + 1));
        }

        throw new Error('AI response is not valid JSON');
    }
};

const parseStrictJsonObjectOrArray = (text) => {
    const normalized = String(text || '').trim();
    if (!normalized) {
        throw new Error('AI returned empty response');
    }

    try {
        const parsed = JSON.parse(normalized);
        if (!parsed || typeof parsed !== 'object') {
            const shapeError = new Error('GEMINI_JSON_PARSE_FAILED');
            shapeError.code = 'GEMINI_JSON_PARSE_FAILED';
            throw shapeError;
        }
        return parsed;
    } catch (_error) {
        const parseError = new Error('GEMINI_JSON_PARSE_FAILED');
        parseError.code = 'GEMINI_JSON_PARSE_FAILED';
        parseError.statusCode = 422;
        throw parseError;
    }
};

const INVALID_NUMBER_TOKENS = new Set([
    '',
    'n/a',
    'na',
    'none',
    'nil',
    'unknown',
    'not sure',
    'not mentioned',
    'not provided',
    '-',
]);

const normalizeTextField = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';
    if (INVALID_NUMBER_TOKENS.has(normalized.toLowerCase())) return '';
    return normalized;
};

const toSafeNumber = (value, {
    fallback = 0,
    round = true,
    pick = 'first',
} = {}) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const safe = Math.max(0, value);
        return round ? Math.round(safe) : safe;
    }

    const normalized = String(value ?? '').trim();
    if (!normalized) return fallback;
    const lowered = normalized.toLowerCase();
    if (INVALID_NUMBER_TOKENS.has(lowered)) return fallback;

    // Examples:
    // "20,000 - 30,000" => [20000, 30000]
    // "25k" => [25000]
    // "4 lakh" => [400000]
    const multiplierMap = {
        k: 1000,
        thousand: 1000,
        lakh: 100000,
        lac: 100000,
        crore: 10000000,
        cr: 10000000,
    };
    const numericCandidates = [];
    const matcher = normalized.replace(/,/g, '').matchAll(/(-?\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|crore|cr)?/gi);
    for (const match of matcher) {
        const base = Number.parseFloat(match?.[1] || '');
        if (!Number.isFinite(base)) continue;
        const suffix = String(match?.[2] || '').toLowerCase();
        const multiplier = multiplierMap[suffix] || 1;
        numericCandidates.push(Math.max(0, base * multiplier));
    }

    if (!numericCandidates.length) return fallback;
    const parsedNumbers = numericCandidates
        .filter((num) => Number.isFinite(num))
        .map((num) => Math.max(0, num));
    if (!parsedNumbers.length) return fallback;

    let picked = parsedNumbers[0];
    if (pick === 'max') picked = Math.max(...parsedNumbers);
    if (pick === 'min') picked = Math.min(...parsedNumbers);
    return round ? Math.round(picked) : picked;
};

const toSkillsArray = (value) => {
    const source = Array.isArray(value)
        ? value
        : String(value ?? '')
            .split(/[,;|\n/]+/g)
            .map((item) => item.trim());

    const seen = new Set();
    return source
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

const toFirstName = (value) => {
    const normalized = normalizeTextField(value);
    if (!normalized) return '';
    const [firstToken = ''] = normalized.split(/\s+/).filter(Boolean);
    return firstToken || '';
};

const sanitizeStructuredAudioExtraction = (raw = {}) => {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const firstName = toFirstName(source.firstName || source.name);
    const city = normalizeTextField(source.city || source.location);
    const roleName = normalizeTextField(source.roleName || source.roleTitle || source.jobTitle);
    const totalExperience = toSafeNumber(
        source.totalExperience ?? source.experienceYears ?? source.experienceRequired,
        { fallback: 0, round: true, pick: 'first' }
    );
    const expectedSalary = toSafeNumber(
        source.expectedSalary ?? source.salaryRange,
        { fallback: 0, round: true, pick: 'max' }
    );
    const skills = toSkillsArray(source.skills || source.requiredSkills);

    return {
        firstName,
        city,
        totalExperience,
        roleName,
        expectedSalary,
        skills,
    };
};

const countExtractionCoverage = (value = {}) => {
    let total = 0;
    if (normalizeTextField(value?.firstName)) total += 1;
    if (normalizeTextField(value?.city)) total += 1;
    if (normalizeTextField(value?.roleName)) total += 1;
    if (toSafeNumber(value?.totalExperience, { fallback: 0 }) > 0) total += 1;
    if (toSafeNumber(value?.expectedSalary, { fallback: 0 }) > 0) total += 1;
    if (Array.isArray(value?.skills) && value.skills.length > 0) total += 1;
    return total;
};

const buildAudioPromptPayload = ({ prompt, audioBase64 }) => ({
    contents: [{
        parts: [
            { text: prompt },
            {
                inlineData: {
                    mimeType: 'audio/mpeg',
                    data: audioBase64,
                },
            },
        ],
    }],
});

const emitExtractionTrace = (context = {}, phase = '', data = {}) => {
    const traceId = String(
        context?.traceId
        || context?.interviewProcessingId
        || context?.correlationId
        || context?.userId
        || 'smart-interview'
    );
    appendSmartInterviewTraceSyncSafe({
        traceId,
        phase,
        data,
    });
};

const executeGeminiRequest = async ({
    payload,
    promptText,
    operation,
    userId = null,
    interviewProcessingId = null,
    preferredModel = null,
    modelChainOverride = null,
    timeoutMs = 10000,
    rateLimitKey = 'global',
    preferredRegion = null,
    metadata = {},
} = {}) => {
    const abuseCheck = await detectHighFrequencyAbuse({ userId, rateLimitKey });
    if (abuseCheck.abusive) {
        await recordAiUsage({
            userId,
            interviewProcessingId,
            operation,
            provider: 'gemini',
            model: preferredModel || DEFAULT_MODEL_CHAIN[0],
            region: preferredRegion || 'unknown',
            prompt: promptText,
            output: '',
            status: 'blocked',
            error: 'high_frequency_abuse_detected',
            metadata: {
                ...metadata,
                abuseCount: abuseCheck.count,
            },
        });
        throw new Error('AI usage temporarily blocked due to high-frequency abuse patterns');
    }

    const budget = await assertAiBudget({ userId });
    if (!budget.allowed) {
        await recordAiUsage({
            userId,
            interviewProcessingId,
            operation,
            provider: 'gemini',
            model: preferredModel || DEFAULT_MODEL_CHAIN[0],
            region: preferredRegion || 'unknown',
            prompt: promptText,
            output: '',
            status: 'blocked',
            error: budget.reason,
            metadata: {
                ...metadata,
                daily: budget.daily,
            },
        });
        throw new Error('AI daily budget exceeded for this account');
    }

    const routing = resolveRoutingContext({
        user: userId ? { primaryRegion: preferredRegion || process.env.APP_REGION } : null,
        requestedRegion: preferredRegion,
    });

    const modelChain = resolveModelChainOverride(modelChainOverride, preferredModel);
    let lastError = null;

    for (let i = 0; i < modelChain.length; i += 1) {
        const model = modelChain[i];
        const fallbackModel = i > 0 ? modelChain[i - 1] : null;
        const modelLower = String(model || '').toLowerCase();
        const payloadGenerationConfig = (
            payload && typeof payload.generationConfig === 'object' && !Array.isArray(payload.generationConfig)
        ) ? payload.generationConfig : {};
        const requestGenerationConfig = { ...payloadGenerationConfig };
        if (requestGenerationConfig.maxOutputTokens === undefined) {
            requestGenerationConfig.maxOutputTokens = toOptionalInt(process.env.GEMINI_DEFAULT_MAX_OUTPUT_TOKENS) || 1024;
        }
        if (requestGenerationConfig.temperature === undefined) {
            requestGenerationConfig.temperature = 0.1;
        }
        const explicitThinkingBudget = toOptionalInt(metadata?.thinkingBudget);
        const envThinkingBudget = toOptionalInt(process.env.GEMINI_DEFAULT_THINKING_BUDGET);
        const derivedThinkingBudget = explicitThinkingBudget !== null
            ? explicitThinkingBudget
            : (envThinkingBudget !== null ? envThinkingBudget : (modelLower.includes('flash') ? 0 : null));
        if (derivedThinkingBudget !== null) {
            requestGenerationConfig.thinkingConfig = {
                thinkingBudget: Math.max(0, derivedThinkingBudget),
            };
        }
        const requestPayload = {
            ...(payload || {}),
            generationConfig: requestGenerationConfig,
        };

        try {
            const response = await axios.post(
                buildGeminiUrl({ model }),
                requestPayload,
                { timeout: timeoutMs }
            );
            const output = extractCandidateText(response.data);
            if (!output) {
                throw new Error('Empty AI response');
            }

            await recordAiUsage({
                userId,
                interviewProcessingId,
                operation,
                provider: 'gemini',
                model,
                fallbackModel,
                region: routing.primaryRegion,
                prompt: promptText,
                output,
                inputTokens: estimateTokensFromText(promptText),
                outputTokens: estimateTokensFromText(output),
                status: 'success',
                metadata: {
                    ...metadata,
                    routedRegion: routing.primaryRegion,
                    failoverRegions: routing.failoverRegions,
                    modelIndex: i,
                },
            });

            return {
                text: output,
                model,
                region: routing.primaryRegion,
                usedFallbackModel: i > 0,
            };
        } catch (error) {
            lastError = error;
            const providerMessage = String(error?.response?.data?.error?.message || error?.message || 'unknown_error');
            await recordAiUsage({
                userId,
                interviewProcessingId,
                operation,
                provider: 'gemini',
                model,
                fallbackModel,
                region: routing.primaryRegion,
                prompt: promptText,
                output: '',
                status: 'failed',
                error: providerMessage,
                metadata: {
                    ...metadata,
                    modelIndex: i,
                    providerStatus: Number(error?.response?.status || 0) || null,
                },
            });
            logger.warn({
                event: 'gemini_request_failed',
                operation,
                model,
                status: Number(error?.response?.status || 0) || null,
                message: providerMessage,
            });
        }
    }

    logger.warn({
        event: 'gemini_model_fallback_exhausted',
        operation,
        modelChain,
        message: lastError?.message || 'unknown_error',
    });
    throw lastError || new Error('Gemini request failed');
};

const extractWorkerDataFromAudio = async (audioPath, userRole = 'worker', context = {}) => {
    const audioBase64 = fs.readFileSync(audioPath).toString('base64');
    const baseModel = context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-2.0-flash';
    const baseRateLimitKey = context.rateLimitKey || String(context.userId || 'audio-extract');
    const defaultAudioModelChain = Array.from(new Set([
        baseModel,
        process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash',
        'gemini-2.0-flash-lite',
    ])).join(',');
    const defaultTextModelChain = Array.from(new Set([
        process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash',
        process.env.GEMINI_PRO_MODEL || 'gemini-2.5-pro',
        'gemini-2.5-flash',
    ])).join(',');
    const audioModelChain = resolveModelChainOverride(
        process.env.GEMINI_AUDIO_MODEL_CHAIN || defaultAudioModelChain,
        baseModel
    );
    const textModelChain = resolveModelChainOverride(
        process.env.GEMINI_TEXT_MODEL_CHAIN || defaultTextModelChain,
        baseModel
    );
    const audioRequestTimeoutMs = Number.parseInt(process.env.GEMINI_AUDIO_TIMEOUT_MS || '15000', 10);
    const textRequestTimeoutMs = Number.parseInt(process.env.GEMINI_TEXT_TIMEOUT_MS || '9000', 10);
    const pipelineTimeoutMs = Number.parseInt(process.env.GEMINI_AUDIO_PIPELINE_TIMEOUT_MS || '45000', 10);
    const pipelineDeadline = Date.now() + pipelineTimeoutMs;
    const remainingTimeout = (preferredMs) => {
        const remainingMs = pipelineDeadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error('Audio extraction timeout budget exceeded');
        }
        return Math.max(4000, Math.min(preferredMs, remainingMs));
    };

    const transcriptPrompt = [
        'You are a speech transcription engine.',
        'Transcribe this interview audio into plain English text.',
        'Return transcript text only. No markdown. No JSON. No explanation.',
    ].join('\n');

    emitExtractionTrace(context, 'pipeline_start', {
        role: userRole,
        audioPath,
        audioBytes: Buffer.byteLength(audioBase64, 'utf8'),
        audioModelChain,
        textModelChain,
    });

    try {
        emitExtractionTrace(context, 'gemini_called', {
            stage: 'transcription',
            operation: 'transcribe_interview_audio',
            modelChain: audioModelChain,
        });
        const transcriptResponse = await executeGeminiRequest({
            payload: buildAudioPromptPayload({ prompt: transcriptPrompt, audioBase64 }),
            promptText: transcriptPrompt,
            operation: 'transcribe_interview_audio',
            userId: context.userId || null,
            interviewProcessingId: context.interviewProcessingId || null,
            preferredModel: baseModel,
            modelChainOverride: audioModelChain,
            timeoutMs: remainingTimeout(audioRequestTimeoutMs),
            rateLimitKey: `${baseRateLimitKey}:transcribe`,
            preferredRegion: context.region || null,
            metadata: {
                role: userRole,
                stage: 'mandatory_transcription',
            },
        });

        const transcriptText = String(transcriptResponse?.text || '')
            .replace(/```/g, '')
            .replace(/^transcript\s*:\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 12000);

        emitExtractionTrace(context, 'transcript_received', {
            transcript: transcriptText,
            transcriptLength: transcriptText.length,
            model: transcriptResponse?.model || null,
        });
        emitExtractionTrace(context, 'stt_transcription_return', {
            transcript: transcriptText,
            transcriptLength: transcriptText.length,
            model: transcriptResponse?.model || null,
        });

        if (!transcriptText) {
            const transcriptError = new Error('Transcription returned empty text');
            transcriptError.statusCode = 422;
            throw transcriptError;
        }

        const extractionPrompt = [
            'You are a deterministic information extraction engine.',
            `The transcript is from a ${userRole === 'worker' ? 'job seeker' : 'recruiter/employer'}.`,
            'Extract only from transcript content. Do not infer beyond spoken data.',
            'Return ONLY one valid JSON object with EXACTLY these keys and no others:',
            '{',
            '  "firstName": "",',
            '  "city": "",',
            '  "totalExperience": 0,',
            '  "roleName": "",',
            '  "expectedSalary": 0,',
            '  "skills": []',
            '}',
            '',
            'Hard rules:',
            '- Output JSON only. No markdown. No explanation.',
            '- Fix spelling for industry terms and role names.',
            '- "totalExperience" and "expectedSalary" must be numbers only.',
            '- Remove commas from numbers (example: "20,000" -> 20000).',
            '- If salary is spoken like "20k", return 20000. If "4 lakh", return 400000.',
            '- If any numeric value is missing or says N/A, return 0.',
            '- "skills" must be an array of strings.',
            '',
            `Transcript: ${JSON.stringify(transcriptText)}`,
        ].join('\n');

        emitExtractionTrace(context, 'gemini_called', {
            stage: 'extraction',
            operation: 'extract_worker_data_from_transcript',
            modelChain: textModelChain,
        });
        const extractionResponse = await executeGeminiRequest({
            payload: {
                contents: [{
                    parts: [{ text: extractionPrompt }],
                }],
            },
            promptText: extractionPrompt,
            operation: 'extract_worker_data_from_transcript',
            userId: context.userId || null,
            interviewProcessingId: context.interviewProcessingId || null,
            preferredModel: baseModel,
            modelChainOverride: textModelChain,
            timeoutMs: remainingTimeout(textRequestTimeoutMs),
            rateLimitKey: `${baseRateLimitKey}:transcript-extract`,
            preferredRegion: context.region || null,
            metadata: {
                role: userRole,
                transcriptLength: transcriptText.length,
            },
        });

        emitExtractionTrace(context, 'gemini_response_received', {
            operation: 'extract_worker_data_from_transcript',
            rawGeminiResponse: extractionResponse?.text || '',
            model: extractionResponse?.model || null,
        });
        emitExtractionTrace(context, 'gemini_raw_response', {
            rawGeminiResponse: extractionResponse?.text || '',
            model: extractionResponse?.model || null,
        });

        const parsed = parseStrictJsonObjectOrArray(extractionResponse.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const invalidShapeError = new Error('Gemini extraction must return a JSON object');
            invalidShapeError.statusCode = 422;
            throw invalidShapeError;
        }

        emitExtractionTrace(context, 'json_parsed', {
            parsedStructuredObject: parsed,
        });
        emitExtractionTrace(context, 'json_parsing_layer', {
            parsedStructuredObject: parsed,
        });

        const sanitizedFinalExtraction = sanitizeStructuredAudioExtraction(parsed);
        const coverage = countExtractionCoverage(sanitizedFinalExtraction);
        const missingFields = [
            ['firstName', !sanitizeStructuredAudioExtraction({ firstName: sanitizedFinalExtraction.firstName }).firstName],
            ['city', !sanitizeStructuredAudioExtraction({ city: sanitizedFinalExtraction.city }).city],
            ['roleName', !sanitizeStructuredAudioExtraction({ roleName: sanitizedFinalExtraction.roleName }).roleName],
            ['totalExperience', !(Number(sanitizedFinalExtraction.totalExperience) > 0)],
            ['expectedSalary', !(Number(sanitizedFinalExtraction.expectedSalary) > 0)],
            ['skills', !(Array.isArray(sanitizedFinalExtraction.skills) && sanitizedFinalExtraction.skills.length > 0)],
        ]
            .filter(([, isMissing]) => isMissing)
            .map(([field]) => field);

        emitExtractionTrace(context, 'validation_layer', {
            coverageScore: coverage,
            missingFields,
            sanitizedExtraction: sanitizedFinalExtraction,
        });

        return {
            ...sanitizedFinalExtraction,
            transcript: transcriptText,
            manualFallbackRequired: coverage < 4,
            coverageScore: coverage,
            missingFields,
        };
    } catch (error) {
        const extractionError = error instanceof Error ? error : new Error(String(error || 'Audio extraction failed'));
        if (!Number.isFinite(Number(extractionError.statusCode))) {
            extractionError.statusCode = 422;
        }
        emitExtractionTrace(context, 'pipeline_error', {
            message: extractionError.message,
            statusCode: extractionError.statusCode,
            role: userRole,
        });
        logger.warn({
            event: 'gemini_extract_failed',
            message: extractionError.message || 'unknown_error',
            role: userRole,
        });
        throw extractionError;
    }
};

const explainMatch = async (jobData, candidateData, score, context = {}) => {
    const jobRequirements = Array.isArray(jobData?.requirements) ? jobData.requirements : [];
    const candidateSkills = Array.isArray(candidateData?.skills) ? candidateData.skills : [];
    const promptText = `
Given this job: ${jobData?.title || 'Unknown'}, Requirements: ${jobRequirements.join(', ')}
And this candidate: Skills: ${candidateSkills.join(', ')}, Experience: ${candidateData?.experience || 'unknown'}, Location: ${candidateData?.location || 'unknown'}
The match score is ${score}%.
Provide 3 concise bullet points explaining why this candidate is a good fit.
Format as JSON array of strings. Do not include markdown formatting like \`\`\`json.
    `;

    const response = await executeSmartBatch({
        model: context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-2.0-flash',
        prompt: promptText,
        metadata: { operation: 'explain_match' },
        ttlMs: Number.parseInt(process.env.AI_BATCH_TTL_MS || '400', 10),
        executor: async () => executeGeminiRequest({
            payload: { contents: [{ parts: [{ text: promptText }] }] },
            promptText,
            operation: 'explain_match',
            userId: context.userId || null,
            interviewProcessingId: context.interviewProcessingId || null,
            preferredModel: context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-2.0-flash',
            timeoutMs: Number.parseInt(process.env.GEMINI_TEXT_TIMEOUT_MS || '9000', 10),
            rateLimitKey: context.rateLimitKey || String(context.userId || 'explain-match'),
            preferredRegion: context.region || null,
            metadata: {
                score,
            },
        }),
    });

    return parseStrictJson(response.text);
};

const suggestJobRequirements = async (jobTitle, context = {}) => {
    const normalizedTitle = String(jobTitle || '').trim();
    if (!normalizedTitle) {
        return [];
    }

    const promptText = `
You are a hiring co-pilot. For the role "${normalizedTitle}", return JSON only in this format:
{
  "requirements": ["..."],
  "screeningQuestions": ["..."],
  "shiftSuggestions": ["Day|Night|Flexible"]
}
Rules:
- Keep requirements concise and practical for frontline hiring.
- Max 8 requirements, max 8 screeningQuestions.
- Avoid personal data.
`;

    const response = await executeSmartBatch({
        model: context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-2.0-flash',
        prompt: promptText,
        metadata: { operation: 'suggest_job_requirements' },
        ttlMs: Number.parseInt(process.env.AI_BATCH_TTL_MS || '400', 10),
        executor: async () => executeGeminiRequest({
            payload: { contents: [{ parts: [{ text: promptText }] }] },
            promptText,
            operation: 'suggest_job_requirements',
            userId: context.userId || null,
            preferredModel: context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-2.0-flash',
            timeoutMs: Number.parseInt(process.env.GEMINI_TEXT_TIMEOUT_MS || '9000', 10),
            rateLimitKey: context.rateLimitKey || String(context.userId || 'suggest-job'),
            preferredRegion: context.region || null,
            metadata: {
                jobTitle: normalizedTitle,
            },
        }),
    });

    const parsed = parseStrictJson(response.text);
    return {
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
        screeningQuestions: Array.isArray(parsed.screeningQuestions) ? parsed.screeningQuestions : [],
        shiftSuggestions: Array.isArray(parsed.shiftSuggestions) ? parsed.shiftSuggestions : ['Flexible'],
    };
};

module.exports = {
    extractWorkerDataFromAudio,
    explainMatch,
    suggestJobRequirements,
};
