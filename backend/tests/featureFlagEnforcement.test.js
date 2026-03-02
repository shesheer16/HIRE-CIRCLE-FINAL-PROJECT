jest.mock('../match/matchProbabilistic', () => ({
    scoreSinglePair: jest.fn(),
}));

const { scoreSinglePair } = require('../match/matchProbabilistic');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
const {
    isProbabilisticMatchEnabled,
    isMatchUiV1Enabled,
} = require('../config/featureFlags');

describe('feature flag enforcement', () => {
    const deterministicScore = {
        finalScore: 0.73,
        matchScore: 73,
        tier: 'GOOD',
        tierLabel: 'Good Match',
        roleData: { roleName: 'Driver' },
        deterministicScores: {
            skillScore: 0.8,
            experienceScore: 0.7,
            salaryFitScore: 0.9,
            distanceScore: 1,
        },
        explainability: { skillScore: 0.8 },
    };

    const worker = { _id: 'worker-1', city: 'Hyderabad' };
    const job = { _id: 'job-1', title: 'Driver', location: 'Hyderabad' };

    afterEach(() => {
        jest.clearAllMocks();
        delete process.env.FF_FEATURE_PROBABILISTIC_MATCH;
        delete process.env.FF_FEATURE_MATCH_UI_V1;
    });

    it('uses deterministic-only path when FEATURE_PROBABILISTIC_MATCH is disabled', async () => {
        const result = await applyOverlay({
            deterministicScore,
            worker,
            job,
            model: {
                user: {
                    featureToggles: {
                        FEATURE_PROBABILISTIC_MATCH: false,
                    },
                },
            },
        });

        expect(scoreSinglePair).not.toHaveBeenCalled();
        expect(result.matchProbability).toBeCloseTo(0.73);
        expect(result.probabilisticFallbackUsed).toBe(true);
        expect(result.explainability.confidenceScore).toBeGreaterThan(0);
    });

    it('uses probabilistic overlay when FEATURE_PROBABILISTIC_MATCH is enabled', async () => {
        scoreSinglePair.mockResolvedValue({
            fallbackUsed: false,
            matchProbability: 0.91,
            tier: 'STRONG',
            tierLabel: 'Strong Match',
            modelVersionUsed: 'v2',
            modelKeyUsed: 'hyderabad::driver',
            explainability: { skillImpact: 0.5 },
        });

        const result = await applyOverlay({
            deterministicScore,
            worker,
            job,
            model: {
                user: {
                    featureToggles: {
                        FEATURE_PROBABILISTIC_MATCH: true,
                    },
                },
            },
        });

        expect(scoreSinglePair).toHaveBeenCalledTimes(1);
        expect(result.matchProbability).toBeCloseTo(0.91);
        expect(result.tier).toBe('STRONG');
        expect(result.probabilisticFallbackUsed).toBe(false);
        expect(result.matchModelVersionUsed).toBe('v2');
        expect(result.explainability.confidenceScore).toBeGreaterThan(0);
        expect(result.explainability.confidenceComponents).toBeDefined();
    });

    it('resolves FEATURE_MATCH_UI_V1 and probabilistic flags via centralized config', () => {
        process.env.FF_FEATURE_PROBABILISTIC_MATCH = 'false';
        process.env.FF_FEATURE_MATCH_UI_V1 = 'true';

        expect(isProbabilisticMatchEnabled({ featureToggles: {} })).toBe(false);
        expect(isMatchUiV1Enabled({ featureToggles: {} })).toBe(true);
    });
});
