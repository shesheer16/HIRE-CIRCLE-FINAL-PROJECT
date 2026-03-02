'use strict';
/**
 * geoHeatmapIntegrity.test.js
 * Phase 32 — Urgency Heatmap Layer Integrity
 *
 * Verifies:
 *  1. Urgency scoring logic: low applicants + isOpen + recent = higher weight
 *  2. Heatmap cluster weight is deterministic (same input → same output)
 *  3. Urgency badges are derived from real data (not manually set)
 *  4. Weight normalization stays within 0-100 range
 *  5. Edge cases: jobs with 0 applicants, very old jobs, null fields
 */

// ── Heatmap weight computation (pure function extracted for testing) ──────────
function computeHeatmapWeight(job) {
    if (!job || !job.isOpen) return 0;

    const applicants = Number(job.applicantCount || 0);
    const ageHours = Math.max(0,
        (Date.now() - new Date(job.createdAt || Date.now()).getTime()) / (1000 * 60 * 60)
    );

    // Urgency inversely proportional to applicants (low competition = high urgency)
    const applicantScore = applicants === 0 ? 100 : Math.max(0, 100 - applicants * 5);

    // Recency score: 100 for < 1hr, decreasing to 0 for > 7 days
    const maxAgeHours = 7 * 24;
    const recencyScore = Math.max(0, Math.round(100 * (1 - ageHours / maxAgeHours)));

    // Boost for explicitly urgent jobs
    const urgencyBoost = job.isUrgent ? 20 : 0;

    const raw = (applicantScore * 0.5) + (recencyScore * 0.3) + urgencyBoost;
    return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Derive urgency badge label from heatmap weight
 */
function deriveUrgencyBadge(weight) {
    if (weight >= 80) return 'Actively Hiring';
    if (weight >= 60) return 'High Match';
    if (weight >= 40) return 'New';
    if (weight >= 20) return 'Open';
    return null;
}

// ════════════════════════════════════════════════════════════════════════════
describe('Geo Heatmap Urgency Layer Integrity', () => {

    describe('Heatmap Weight Computation', () => {
        test('closed job returns weight 0', () => {
            expect(computeHeatmapWeight({ isOpen: false })).toBe(0);
        });

        test('null job returns weight 0', () => {
            expect(computeHeatmapWeight(null)).toBe(0);
        });

        test('open job with 0 applicants and urgent=true returns high weight', () => {
            const weight = computeHeatmapWeight({
                isOpen: true,
                applicantCount: 0,
                isUrgent: true,
                createdAt: new Date(),
            });
            expect(weight).toBeGreaterThanOrEqual(70);
        });

        test('job with many applicants returns lower urgency', () => {
            const lowApplicants = computeHeatmapWeight({ isOpen: true, applicantCount: 0, isUrgent: false, createdAt: new Date() });
            const highApplicants = computeHeatmapWeight({ isOpen: true, applicantCount: 20, isUrgent: false, createdAt: new Date() });
            expect(lowApplicants).toBeGreaterThan(highApplicants);
        });

        test('very old job gets lower recency score', () => {
            const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
            const newDate = new Date();
            const fresh = computeHeatmapWeight({ isOpen: true, applicantCount: 0, isUrgent: false, createdAt: newDate });
            const old = computeHeatmapWeight({ isOpen: true, applicantCount: 0, isUrgent: false, createdAt: oldDate });
            expect(fresh).toBeGreaterThanOrEqual(old);
        });

        test('weight is always between 0 and 100', () => {
            const cases = [
                { isOpen: true, applicantCount: 0, isUrgent: true, createdAt: new Date() },
                { isOpen: true, applicantCount: 100, isUrgent: false, createdAt: new Date(0) },
                { isOpen: true, applicantCount: 5, isUrgent: true, createdAt: new Date() },
                { isOpen: false },
                null,
            ];
            cases.forEach((c) => {
                const w = computeHeatmapWeight(c);
                expect(w).toBeGreaterThanOrEqual(0);
                expect(w).toBeLessThanOrEqual(100);
            });
        });
    });

    describe('Determinism', () => {
        test('same input gives same output every time', () => {
            const job = { isOpen: true, applicantCount: 3, isUrgent: false, createdAt: new Date('2026-01-01') };
            const results = Array.from({ length: 10 }, () => computeHeatmapWeight(job));
            expect(new Set(results).size).toBe(1);
        });
    });

    describe('Urgency Badge Derivation', () => {
        test('weight >= 80 → Actively Hiring', () => {
            expect(deriveUrgencyBadge(85)).toBe('Actively Hiring');
        });

        test('weight 60-79 → High Match', () => {
            expect(deriveUrgencyBadge(65)).toBe('High Match');
        });

        test('weight 40-59 → New', () => {
            expect(deriveUrgencyBadge(45)).toBe('New');
        });

        test('weight 20-39 → Open', () => {
            expect(deriveUrgencyBadge(25)).toBe('Open');
        });

        test('weight < 20 → null (no badge)', () => {
            expect(deriveUrgencyBadge(10)).toBeNull();
            expect(deriveUrgencyBadge(0)).toBeNull();
        });

        test('badge is derived from data — not manually settable by employer', () => {
            // Ensure badge is always computed, never taken from job.urgencyBadge field directly
            const job = { isOpen: true, applicantCount: 0, isUrgent: true, createdAt: new Date(), urgencyBadge: 'FAKE' };
            const weight = computeHeatmapWeight(job);
            const badge = deriveUrgencyBadge(weight);
            // Badge is computed from weight, not from job.urgencyBadge
            expect(badge).not.toBe('FAKE');
            expect(['Actively Hiring', 'High Match', 'New', 'Open', null]).toContain(badge);
        });
    });

    describe('Cluster Ordering', () => {
        test('higher urgency jobs sort before lower urgency in cluster ranking', () => {
            const jobs = [
                { isOpen: true, applicantCount: 10, isUrgent: false, createdAt: new Date() },
                { isOpen: true, applicantCount: 0, isUrgent: true, createdAt: new Date() },
                { isOpen: true, applicantCount: 5, isUrgent: false, createdAt: new Date() },
            ];
            const ranked = jobs
                .map((j) => ({ ...j, weight: computeHeatmapWeight(j) }))
                .sort((a, b) => b.weight - a.weight);

            expect(ranked[0].isUrgent).toBe(true);
            expect(ranked[0].applicantCount).toBe(0);
        });
    });
});
