'use strict';

/**
 * socialProofIntegrity.test.js
 * Tests socialProofService for accuracy, no fake inflation, and input validation.
 */

const { getWorkerProofLabels, getEmployerProofLabels, validateProofStats } = require('../services/socialProofService');

describe('Profile – Social Proof Integrity', () => {
    describe('Worker proof labels', () => {
        test('Reports correct hire count', () => {
            const labels = getWorkerProofLabels({ hireCount: 3 });
            expect(labels).toContain('Hired 3 times');
        });

        test('No hire label when hireCount = 0', () => {
            const labels = getWorkerProofLabels({ hireCount: 0 });
            expect(labels.find((l) => l.includes('Hired'))).toBeUndefined();
        });

        test('Singular hire label when hireCount = 1', () => {
            const labels = getWorkerProofLabels({ hireCount: 1 });
            expect(labels).toContain('Hired 1 time');
        });

        test('Fast responder label for <2h response', () => {
            const labels = getWorkerProofLabels({ avgResponseHours: 1.5 });
            expect(labels).toContain('Fast responder');
        });

        test('No fast responder label for >2h response', () => {
            const labels = getWorkerProofLabels({ avgResponseHours: 5 });
            expect(labels.find((l) => l === 'Fast responder')).toBeUndefined();
        });

        test('Active this week label for recent activity', () => {
            const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
            const labels = getWorkerProofLabels({ lastActiveAt: recent });
            expect(labels).toContain('Active this week');
        });

        test('No active label for 30-day-old activity', () => {
            const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const labels = getWorkerProofLabels({ lastActiveAt: old });
            expect(labels).not.toContain('Active this week');
        });

        test('Interview count shown when >= 2', () => {
            const labels = getWorkerProofLabels({ interviewCount: 5 });
            expect(labels).toContain('Interviewed 5 times');
        });
    });

    describe('Employer proof labels', () => {
        test('Reports correct hire count', () => {
            const labels = getEmployerProofLabels({ totalHires: 27 });
            expect(labels).toContain('Hired 27 candidates');
        });

        test('Active recruiter label when currently hiring', () => {
            const labels = getEmployerProofLabels({ isCurrentlyHiring: true });
            expect(labels).toContain('Active recruiter');
        });

        test('Response time label formatted correctly', () => {
            const labels = getEmployerProofLabels({ avgResponseHours: 1.2 });
            expect(labels.some((l) => l.includes('response'))).toBe(true);
        });
    });

    describe('validateProofStats', () => {
        test('Valid stats pass validation', () => {
            expect(validateProofStats({ hireCount: 3, interviewCount: 5, avgResponseHours: 2 })).toBe(true);
        });

        test('Negative hire count throws', () => {
            expect(() => validateProofStats({ hireCount: -1 })).toThrow();
        });

        test('Unrealistically high hire count throws', () => {
            expect(() => validateProofStats({ hireCount: 99999 })).toThrow();
        });

        test('Empty stats are valid', () => {
            expect(validateProofStats({})).toBe(true);
        });
    });
});
