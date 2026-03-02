const { evaluateCityBalancing } = require('../match/cityBalancingLayer');

describe('cityBalancingLayer', () => {
    it('relaxes possible threshold and raises acquisition alert in undersupplied cities', () => {
        const result = evaluateCityBalancing({
            workersPerJob: 1.7,
            currentThresholds: { STRONG: 0.82, GOOD: 0.7, POSSIBLE: 0.62 },
            currentSkillWeightDelta: 0,
        });

        expect(result.acquisitionAlert).toBe(true);
        expect(result.oversupplyStrictMode).toBe(false);
        expect(result.thresholds).toEqual({
            STRONG: 0.82,
            GOOD: 0.7,
            POSSIBLE: 0.6,
        });
        expect(result.skillWeightDelta).toBe(0);
    });

    it('tightens strong threshold and boosts skill delta in oversupplied cities', () => {
        const result = evaluateCityBalancing({
            workersPerJob: 8.5,
            currentThresholds: { STRONG: 0.82, GOOD: 0.7, POSSIBLE: 0.62 },
            currentSkillWeightDelta: 0.01,
        });

        expect(result.acquisitionAlert).toBe(false);
        expect(result.oversupplyStrictMode).toBe(true);
        expect(result.thresholds).toEqual({
            STRONG: 0.84,
            GOOD: 0.7,
            POSSIBLE: 0.62,
        });
        expect(result.skillWeightDelta).toBe(0.04);
    });

    it('keeps values bounded and tier order valid', () => {
        const result = evaluateCityBalancing({
            workersPerJob: 999,
            currentThresholds: { STRONG: 0.99, GOOD: 0.98, POSSIBLE: 0.97 },
            currentSkillWeightDelta: 9,
        });

        expect(result.thresholds.STRONG).toBeLessThanOrEqual(0.95);
        expect(result.thresholds.GOOD).toBeLessThan(result.thresholds.STRONG);
        expect(result.thresholds.POSSIBLE).toBeLessThan(result.thresholds.GOOD);
        expect(result.skillWeightDelta).toBeLessThanOrEqual(0.08);
    });
});
