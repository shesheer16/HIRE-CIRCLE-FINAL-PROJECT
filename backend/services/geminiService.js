const axios = require('axios');
const fs = require('fs');

const logger = require('../utils/logger');
const { resolveRoutingContext } = require('./regionRoutingService');
const {
    recordAiUsage,
    assertAiBudget,
    detectHighFrequencyAbuse,
    executeSmartBatch,
    estimateTokensFromText,
} = require('./aiCostOptimizationService');

const DEFAULT_MODEL_CHAIN = String(process.env.AI_MODEL_CHAIN || 'gemini-1.5-flash,gemini-flash-latest,gemini-1.5-pro')
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const readApiKey = () => {
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!key) {
        throw new Error('Missing GEMINI_API_KEY');
    }
    return key;
};

const normalizeModel = (model) => String(model || '').trim();

const resolveModelChain = (preferredModel = null) => {
    const preferred = normalizeModel(preferredModel);
    if (!preferred) return DEFAULT_MODEL_CHAIN;

    return Array.from(new Set([preferred, ...DEFAULT_MODEL_CHAIN]));
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

const buildManualFallbackData = (userRole = 'worker') => {
    if (userRole === 'worker') {
        return {
            name: null,
            roleTitle: null,
            skills: [],
            experienceYears: null,
            expectedSalary: null,
            preferredShift: null,
            location: null,
            summary: null,
            manualFallbackRequired: true,
        };
    }

    return {
        jobTitle: null,
        companyName: null,
        requiredSkills: [],
        experienceRequired: null,
        salaryRange: null,
        shift: null,
        location: null,
        description: null,
        manualFallbackRequired: true,
    };
};

const executeGeminiRequest = async ({
    payload,
    promptText,
    operation,
    userId = null,
    interviewProcessingId = null,
    preferredModel = null,
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

    const modelChain = resolveModelChain(preferredModel);
    let lastError = null;

    for (let i = 0; i < modelChain.length; i += 1) {
        const model = modelChain[i];
        const fallbackModel = i > 0 ? modelChain[i - 1] : null;

        try {
            const response = await axios.post(
                buildGeminiUrl({ model }),
                payload,
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
                error: error.message,
                metadata: {
                    ...metadata,
                    modelIndex: i,
                },
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

    const extractionPrompt = `
You are extracting structured hiring data from a voice transcript.
The speaker is a ${userRole === 'worker' ? 'job seeker describing themselves' : 'employer describing a job opening'}.

Extract and return ONLY valid JSON with these exact fields:
${userRole === 'worker' ? `
{
  "name": "full name if mentioned, else null",
  "roleTitle": "job title or role they do",
  "skills": ["skill1", "skill2"],
  "experienceYears": number or null,
  "expectedSalary": "salary expectation as string",
  "preferredShift": "day/night/flexible/any",
  "location": "city or area if mentioned",
  "summary": "2-3 sentence professional summary based on what they said"
}` : `
{
  "jobTitle": "the job title needed",
  "companyName": "company name if mentioned",
  "requiredSkills": ["skill1", "skill2"],
  "experienceRequired": "experience requirement as string",
  "salaryRange": "salary range offered",
  "shift": "day/night/flexible/any",
  "location": "job location",
  "description": "2-3 sentence job description"
}`}

Rules:
- Return ONLY the JSON object, no extra text.
- If something is not mentioned, use null.
- Normalize shorthand skill names to standard names.
`;

    const payload = {
        contents: [{
            parts: [
                { text: extractionPrompt },
                {
                    inlineData: {
                        mimeType: 'audio/mp3',
                        data: audioBase64,
                    },
                },
            ],
        }],
    };

    try {
        const response = await executeGeminiRequest({
            payload,
            promptText: extractionPrompt,
            operation: 'extract_worker_data_from_audio',
            userId: context.userId || null,
            interviewProcessingId: context.interviewProcessingId || null,
            preferredModel: context.model || process.env.SMART_INTERVIEW_GEMINI_MODEL || 'gemini-1.5-flash',
            timeoutMs: Number.parseInt(process.env.GEMINI_AUDIO_TIMEOUT_MS || '15000', 10),
            rateLimitKey: context.rateLimitKey || String(context.userId || 'audio-extract'),
            preferredRegion: context.region || null,
            metadata: {
                role: userRole,
                audioBytes: Buffer.byteLength(audioBase64, 'utf8'),
            },
        });

        const parsed = parseStrictJson(response.text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                ...parsed,
                manualFallbackRequired: false,
            };
        }
        return buildManualFallbackData(userRole);
    } catch (error) {
        logger.warn({
            event: 'gemini_extract_fallback',
            message: error?.message || 'unknown_error',
            role: userRole,
        });
        return buildManualFallbackData(userRole);
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
        model: context.model || 'gemini-1.5-flash',
        prompt: promptText,
        metadata: { operation: 'explain_match' },
        ttlMs: Number.parseInt(process.env.AI_BATCH_TTL_MS || '400', 10),
        executor: async () => executeGeminiRequest({
            payload: { contents: [{ parts: [{ text: promptText }] }] },
            promptText,
            operation: 'explain_match',
            userId: context.userId || null,
            interviewProcessingId: context.interviewProcessingId || null,
            preferredModel: context.model || 'gemini-1.5-flash',
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
        model: context.model || 'gemini-1.5-flash',
        prompt: promptText,
        metadata: { operation: 'suggest_job_requirements' },
        ttlMs: Number.parseInt(process.env.AI_BATCH_TTL_MS || '400', 10),
        executor: async () => executeGeminiRequest({
            payload: { contents: [{ parts: [{ text: promptText }] }] },
            promptText,
            operation: 'suggest_job_requirements',
            userId: context.userId || null,
            preferredModel: context.model || 'gemini-1.5-flash',
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
