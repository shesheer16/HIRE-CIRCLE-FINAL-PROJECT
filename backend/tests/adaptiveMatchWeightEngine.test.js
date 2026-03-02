const {
    applyBounds,
    resolveScopeKey,
    validateAdaptiveWeights,
} = require('../services/adaptiveMatchWeightEngine');

describe('adaptiveMatchWeightEngine', () => {
    it('resolves scoped key for city role context', () => {
        const scope = resolveScopeKey({ city: 'Hyderabad', roleCluster: 'Driver' });
        expect(scope.scopeType).toBe('city_role');
        expect(scope.scopeKey).toBe('hyderabad::driver');
    });

    it('keeps adaptive weights bounded and normalized', () => {
        const bounded = applyBounds({
            skillWeight: 4,
            experienceWeight: -2,
            salaryToleranceWeight: 0.0001,
            commuteToleranceWeight: 99,
        });

        const validation = validateAdaptiveWeights(bounded);
        expect(validation.finite).toBe(true);
        expect(validation.nonNegative).toBe(true);
        expect(validation.bounded).toBe(true);
        expect(validation.total).toBeGreaterThan(0.95);
        expect(validation.total).toBeLessThan(1.05);
    });
});
