const { runOptimizationStressValidation } = require('../services/aiOptimizationStressValidationService');

describe('aiOptimizationStressValidationService', () => {
    it('passes bounded stability checks under simulated load', () => {
        const report = runOptimizationStressValidation();

        expect(report.simulated.matches).toBe(1000);
        expect(report.simulated.hires).toBe(500);
        expect(report.simulated.rejections).toBe(300);

        expect(report.checks.noUnstableWeightExplosion).toBe(true);
        expect(report.checks.noNaN).toBe(true);
        expect(report.checks.noNegativeScore).toBe(true);
        expect(report.checks.noInfiniteRankingLoop).toBe(true);
    });
});
