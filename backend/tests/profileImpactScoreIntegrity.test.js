'use strict';

/**
 * profileImpactScoreIntegrity.test.js
 * Tests profileImpactScoreService determinism, bounds, weight accuracy, and manipulation resistance.
 */

const {
    computeImpactScore,
    scoreCompletion,
    scoreVerification,
    scoreInterview,
    scoreResponseTime,
    scoreHistory,
    scoreEndorsements,
    normalizeTrust,
    WEIGHTS,
} = require('../services/profileImpactScoreService');

describe('Profile – Impact Score Integrity', () => {
    describe('Individual scorers', () => {
        test('scoreCompletion: 100% → max points', () => {
            expect(scoreCompletion(100)).toBe(WEIGHTS.profileCompletion);
        });
        test('scoreCompletion: 0% → 0 points', () => {
            expect(scoreCompletion(0)).toBe(0);
        });
        test('scoreCompletion: 50% → ~13 points', () => {
            expect(scoreCompletion(50)).toBe(13);
        });

        test('scoreVerification: Verified Pro → 20', () => {
            expect(scoreVerification('Verified Pro')).toBe(20);
        });
        test('scoreVerification: Gold → 16', () => {
            expect(scoreVerification('Gold')).toBe(16);
        });
        test('scoreVerification: null → 0', () => {
            expect(scoreVerification(null)).toBe(0);
        });

        test('scoreInterview: 100 → max points', () => {
            expect(scoreInterview(100)).toBe(WEIGHTS.smartInterview);
        });
        test('scoreInterview: 0 → 0', () => {
            expect(scoreInterview(0)).toBe(0);
        });

        test('scoreResponseTime: <1h → 10', () => {
            expect(scoreResponseTime(0.5)).toBe(10);
        });
        test('scoreResponseTime: >24h → 0', () => {
            expect(scoreResponseTime(25)).toBe(0);
        });
        test('scoreResponseTime: null → 0', () => {
            expect(scoreResponseTime(null)).toBe(0);
        });

        test('scoreHistory: 20 activity → 10', () => {
            expect(scoreHistory(15, 5)).toBe(10);
        });
        test('scoreHistory: 0 → 0', () => {
            expect(scoreHistory(0, 0)).toBe(0);
        });

        test('scoreEndorsements: 10+ → 5', () => {
            expect(scoreEndorsements(10)).toBe(5);
        });
        test('scoreEndorsements: 0 → 0', () => {
            expect(scoreEndorsements(0)).toBe(0);
        });

        test('normalizeTrust: 100 raw → 10 pts', () => {
            expect(normalizeTrust(100)).toBe(10);
        });
        test('normalizeTrust: 0 → 0', () => {
            expect(normalizeTrust(0)).toBe(0);
        });
        test('normalizeTrust: >100 clamped to 10', () => {
            expect(normalizeTrust(200)).toBe(10);
        });
    });

    describe('computeImpactScore', () => {
        test('Max score: fully verified user gets 100', () => {
            const result = computeImpactScore({
                completionPercent: 100,
                verificationTier: 'Verified Pro',
                interviewScore: 100,
                responseTimeHours: 0.5,
                hireCount: 15,
                interviewCount: 5,
                trustScore: 100,
                endorsementCount: 10,
            });
            expect(result.total).toBe(100);
        });

        test('Zero everything → 0 score', () => {
            const result = computeImpactScore({});
            expect(result.total).toBe(0);
        });

        test('Score is deterministic (same input = same output)', () => {
            const params = { completionPercent: 75, verificationTier: 'Silver', interviewScore: 60 };
            const r1 = computeImpactScore(params);
            const r2 = computeImpactScore(params);
            expect(r1.total).toBe(r2.total);
            expect(r1.breakdown).toEqual(r2.breakdown);
        });

        test('Score never exceeds 100', () => {
            const result = computeImpactScore({
                completionPercent: 100,
                verificationTier: 'Verified Pro',
                interviewScore: 100,
                responseTimeHours: 0.1,
                hireCount: 100,
                trustScore: 100,
                endorsementCount: 100,
            });
            expect(result.total).toBeLessThanOrEqual(100);
        });

        test('Breakdown fields sum equals total', () => {
            const result = computeImpactScore({
                completionPercent: 80,
                verificationTier: 'Gold',
                interviewScore: 70,
                responseTimeHours: 2,
                hireCount: 3,
                trustScore: 75,
                endorsementCount: 5,
            });
            const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
            expect(result.total).toBe(Math.min(100, sum));
        });

        test('Percentile summary is returned as a string', () => {
            const result = computeImpactScore({ completionPercent: 50, verificationTier: 'Bronze' });
            expect(typeof result.percentileSummary).toBe('string');
        });

        test('Improvement tip is returned for incomplete profile', () => {
            const result = computeImpactScore({ completionPercent: 0 });
            expect(result.improvementTip).toBeTruthy();
        });
    });
});
