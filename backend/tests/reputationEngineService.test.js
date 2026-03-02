const {
    classifyTrustStatus,
    computeDecayPenalty,
    computeDisputeImpact,
    buildTrustScoreExplanation,
} = require('../services/reputationEngineService');

describe('reputationEngineService', () => {
    it('keeps decay penalty bounded and gradual', () => {
        const activePenalty = computeDecayPenalty({
            lastActivityAt: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)),
            recentHireCount: 2,
        });
        const stalePenalty = computeDecayPenalty({
            lastActivityAt: new Date(Date.now() - (240 * 24 * 60 * 60 * 1000)),
            recentHireCount: 0,
        });

        expect(activePenalty).toBe(0);
        expect(stalePenalty).toBeGreaterThan(activePenalty);
        expect(stalePenalty).toBeLessThanOrEqual(16);
    });

    it('applies dispute impact with bounded visibility degradation', () => {
        const impact = computeDisputeImpact({
            disputesRaised: 8,
            disputesLost: 4,
            fraudOpenCount: 2,
            fraudSeverityScore: 150,
            refundAbuseCount: 2,
            openRiskFlags: 3,
        });

        expect(impact.penalty).toBeGreaterThan(0);
        expect(impact.penalty).toBeLessThanOrEqual(35);
        expect(impact.visibilityMultiplier).toBeGreaterThanOrEqual(0.4);
        expect(impact.visibilityMultiplier).toBeLessThanOrEqual(1);
        expect(impact.adminReviewRequired).toBe(true);
    });

    it('maps trust status thresholds deterministically', () => {
        expect(classifyTrustStatus(80)).toBe('healthy');
        expect(classifyTrustStatus(70)).toBe('watch');
        expect(classifyTrustStatus(50)).toBe('flagged');
        expect(classifyTrustStatus(20)).toBe('restricted');
    });

    it('builds transparent trust explanation payload', () => {
        const explanation = buildTrustScoreExplanation({
            overallTrustScore: 78.2,
            decayPenalty: 1.5,
            disputeImpactPenalty: 2.1,
            breakdown: [
                { label: 'Reliability', value: 82, contribution: 19.68 },
                { label: 'Hire Success', value: 74, contribution: 14.8 },
                { label: 'Network Authority', value: 70, contribution: 11.2 },
            ],
        });

        expect(explanation.title).toContain('78');
        expect(explanation.topFactors.length).toBeGreaterThan(0);
        expect(explanation.formula).toBe('weighted_sum(components) - decay_penalty - dispute_impact_penalty');
    });
});
