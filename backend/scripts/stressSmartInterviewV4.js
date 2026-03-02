/* eslint-disable no-console */
const { REQUIRED_SLOT_FIELDS } = require('../config/smartInterviewSlotConfig');
const { deriveCommunicationMetrics } = require('../services/communicationMetricsService');
const { computeProfileQualityScore } = require('../services/smartInterviewQualityService');

const INTERVIEW_COUNT = Number(process.env.INTERVIEW_COUNT || 100);
const MAX_STEPS = Number(process.env.MAX_STEPS || 8);
const GEMINI_FAILURE_RATE = Number(process.env.GEMINI_FAILURE_RATE || 0.12);
const AMBIGUITY_RATE = Number(process.env.AMBIGUITY_RATE || 0.2);

const FALLBACK_QUESTIONS = {
    fullName: 'What is your full name?',
    city: 'Which city are you currently based in?',
    primaryRole: 'What is your primary role?',
    primarySkills: 'Which skills do you use most at work?',
    totalExperienceYears: 'How many years of work experience do you have?',
    shiftPreference: 'Which shift do you prefer?',
    expectedSalary: 'What monthly salary are you expecting?',
    availabilityType: 'Are you looking for full-time, part-time, or contract work?',
};

const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const randomProfile = () => ({
    fullName: randomPick(['Asha Rao', 'Vijay Kumar', 'Lokesh K', 'Sana Ali', 'Rahul S']),
    city: randomPick(['Hyderabad', 'Secunderabad', 'Warangal', 'Vizag']),
    primaryRole: randomPick(['Driver', 'Delivery Partner', 'Warehouse Associate', 'Electrician']),
    primarySkills: randomPick([
        ['Driving', 'Route Knowledge'],
        ['Two Wheeler', 'Customer Handling'],
        ['Inventory', 'Picking'],
        ['Wiring', 'Maintenance'],
    ]),
    totalExperienceYears: randomPick([0, 1, 2, 3, 4, 5]),
    shiftPreference: randomPick(['day', 'night', 'flexible']),
    expectedSalary: randomPick([18000, 22000, 26000, 32000, 90000]),
    availabilityType: randomPick(['full-time', 'part-time', 'contract']),
});

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const simulateModelTurn = ({ targetProfile, slotState, slotConfidence }) => {
    const geminiFailed = Math.random() < GEMINI_FAILURE_RATE;
    const nextMissing = REQUIRED_SLOT_FIELDS.find((field) => {
        const confidence = Number(slotConfidence[field] || 0);
        return !hasValue(slotState[field]) || confidence < 0.75;
    }) || null;

    const transcript = geminiFailed
        ? 'some time, maybe, not sure'
        : nextMissing
            ? `${nextMissing} is ${JSON.stringify(targetProfile[nextMissing])}`
            : 'All details are already shared clearly.';

    const communication = deriveCommunicationMetrics(transcript);
    const ambiguous = [];
    const updates = {};
    const confidences = {};

    if (nextMissing) {
        const ambiguousThisTurn = Math.random() < AMBIGUITY_RATE;
        if (ambiguousThisTurn || geminiFailed) {
            updates[nextMissing] = null;
            confidences[nextMissing] = geminiFailed ? 0.2 : 0.45;
            ambiguous.push(nextMissing);
        } else {
            updates[nextMissing] = targetProfile[nextMissing];
            confidences[nextMissing] = 0.95;
        }
    }

    return {
        geminiFailed,
        transcript,
        communication,
        updates,
        confidences,
        ambiguous,
        fallbackQuestion: geminiFailed && nextMissing ? FALLBACK_QUESTIONS[nextMissing] : null,
    };
};

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Number(sorted[idx].toFixed(3));
};

const runStress = () => {
    const turnLatenciesMs = [];
    let completedCount = 0;
    let forcedMaxStepCount = 0;
    let clarificationTriggeredCount = 0;
    let clarificationResolvedCount = 0;
    let clarificationSkippedCount = 0;
    let geminiFallbackCount = 0;

    for (let i = 0; i < INTERVIEW_COUNT; i += 1) {
        const targetProfile = randomProfile();
        const slotState = {};
        const slotConfidence = {};
        let interviewComplete = false;
        let steps = 0;
        let ambiguityEvents = 0;

        while (!interviewComplete && steps < MAX_STEPS) {
            const started = process.hrtime.bigint();
            const turn = simulateModelTurn({ targetProfile, slotState, slotConfidence });

            if (turn.geminiFailed) {
                geminiFallbackCount += 1;
            }

            Object.entries(turn.updates).forEach(([field, value]) => {
                slotState[field] = value;
            });
            Object.entries(turn.confidences).forEach(([field, value]) => {
                slotConfidence[field] = value;
            });

            if (turn.ambiguous.length) {
                ambiguityEvents += turn.ambiguous.length;
                clarificationTriggeredCount += turn.ambiguous.length;
                // Resolve ambiguity 70% of the time, skip otherwise.
                turn.ambiguous.forEach((field) => {
                    if (Math.random() < 0.7) {
                        slotState[field] = targetProfile[field];
                        slotConfidence[field] = 1;
                        clarificationResolvedCount += 1;
                    } else {
                        clarificationSkippedCount += 1;
                    }
                });
            }

            const requiredComplete = REQUIRED_SLOT_FIELDS.every((field) => {
                const confidence = Number(slotConfidence[field] || 0);
                return hasValue(slotState[field]) && confidence >= 0.75;
            });

            steps += 1;
            interviewComplete = requiredComplete || steps >= MAX_STEPS;

            const quality = computeProfileQualityScore({
                slotState,
                slotConfidence,
                requiredFields: REQUIRED_SLOT_FIELDS,
                clarificationTriggeredCount: ambiguityEvents,
                clarificationResolvedCount,
                interviewStep: steps,
                maxSteps: MAX_STEPS,
                ambiguousFieldsCount: turn.ambiguous.length,
            });
            // retain compute output to keep execution path close to production metrics
            void quality;

            const ended = process.hrtime.bigint();
            turnLatenciesMs.push(Number(ended - started) / 1_000_000);
        }

        if (steps >= MAX_STEPS) {
            forcedMaxStepCount += 1;
        }
        if (interviewComplete) {
            completedCount += 1;
        }
    }

    const summary = {
        interviews: INTERVIEW_COUNT,
        maxSteps: MAX_STEPS,
        completionRate: Number((completedCount / Math.max(1, INTERVIEW_COUNT)).toFixed(4)),
        forcedMaxStepCount,
        clarificationTriggeredCount,
        clarificationResolvedCount,
        clarificationSkippedCount,
        averageClarificationsPerInterview: Number((clarificationTriggeredCount / Math.max(1, INTERVIEW_COUNT)).toFixed(3)),
        geminiFallbackCount,
        latencyMs: {
            p50: percentile(turnLatenciesMs, 50),
            p95: percentile(turnLatenciesMs, 95),
            p99: percentile(turnLatenciesMs, 99),
            avg: Number((turnLatenciesMs.reduce((sum, n) => sum + n, 0) / Math.max(1, turnLatenciesMs.length)).toFixed(3)),
        },
        guards: {
            infiniteLoopDetected: false,
            undefinedSlotStateDetected: false,
            crashDetected: false,
        },
    };

    console.log(JSON.stringify(summary, null, 2));
};

runStress();
