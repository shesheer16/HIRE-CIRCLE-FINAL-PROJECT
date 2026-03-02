const {
    computeDisputeImpact,
    buildTrustScoreExplanation,
    classifyTrustStatus,
} = require('../services/reputationEngineService');

describe('profile trust score validation', () => {
    it('clamps dispute impact outputs and avoids numeric overflow', () => {
        const impact = computeDisputeImpact({
            disputesRaised: 1000,
            disputesLost: 1000,
            fraudOpenCount: 1000,
            fraudSeverityScore: 100000,
            refundAbuseCount: 1000,
            openRiskFlags: 1000,
        });

        expect(impact.penalty).toBeLessThanOrEqual(35);
        expect(impact.penalty).toBeGreaterThanOrEqual(0);
        expect(impact.visibilityMultiplier).toBeGreaterThanOrEqual(0.4);
        expect(impact.visibilityMultiplier).toBeLessThanOrEqual(1);
        expect(impact.adminReviewRequired).toBe(true);
    });

    it('builds explanation with dispute penalty and preserves healthy status for clean new user scores', () => {
        const explanation = buildTrustScoreExplanation({
            overallTrustScore: 88.456,
            decayPenalty: 0,
            disputeImpactPenalty: 9.2,
            breakdown: [
                { label: 'Reliability', value: 94, contribution: 22.56 },
                { label: 'Response Behavior', value: 87, contribution: 12.18 },
                { label: 'Network Authority', value: 80, contribution: 12.8 },
            ],
        });

        expect(explanation.trustScore).toBe(88.46);
        expect(explanation.penalties).toContain('dispute impact -9.2');
        expect(explanation.topFactors.length).toBe(3);
        expect(classifyTrustStatus(88.46)).toBe('healthy');
    });
});
