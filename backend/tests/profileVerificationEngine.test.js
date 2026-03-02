'use strict';

/**
 * profileVerificationEngine.test.js
 * Tests the profileVerificationEngine service:
 *  - Deterministic output for same inputs
 *  - Correct tier assignment
 *  - Badge list accuracy
 *  - No spoofable override
 */

const { computeVerificationProfile, getTierForPoints, TIER_THRESHOLDS } = require('../services/profileVerificationEngine');

describe('Profile – Verification Engine', () => {
    describe('Tier Thresholds', () => {
        test('Verified Pro requires highest points', () => {
            expect(TIER_THRESHOLDS['Verified Pro']).toBeGreaterThan(TIER_THRESHOLDS['Gold']);
        });
        test('Gold > Silver > Bronze', () => {
            expect(TIER_THRESHOLDS.Gold).toBeGreaterThan(TIER_THRESHOLDS.Silver);
            expect(TIER_THRESHOLDS.Silver).toBeGreaterThan(TIER_THRESHOLDS.Bronze);
        });
    });

    describe('getTierForPoints', () => {
        test('100 points → Verified Pro', () => {
            expect(getTierForPoints(100)).toBe('Verified Pro');
        });
        test('70 points → Gold', () => {
            expect(getTierForPoints(70)).toBe('Gold');
        });
        test('45 points → Silver', () => {
            expect(getTierForPoints(45)).toBe('Silver');
        });
        test('10 points → Bronze', () => {
            expect(getTierForPoints(10)).toBe('Bronze');
        });
        test('0 points → null', () => {
            expect(getTierForPoints(0)).toBeNull();
        });
    });

    describe('computeVerificationProfile — Worker', () => {
        test('Phone + email verified worker gets Bronze or Silver', () => {
            const result = computeVerificationProfile(
                { phoneVerified: true, emailVerified: true },
                null,
                null
            );
            expect(result.points).toBeGreaterThanOrEqual(10);
            expect(result.badges).toContain('phone_verified');
            expect(result.badges).toContain('email_verified');
        });

        test('Fully verified worker (phone + email + interview + skills) gets Silver+', () => {
            const result = computeVerificationProfile(
                { phoneVerified: true, emailVerified: true },
                { smartInterviewCompleted: true, interviewScore: 85, skills: ['Driver', 'Cook', 'Cleaner'] },
                null
            );
            expect(result.points).toBeGreaterThanOrEqual(45);
            expect(result.badges).toContain('interview_verified');
            expect(result.badges).toContain('skill_verified');
        });

        test('Unverified user gets no tier', () => {
            const result = computeVerificationProfile({}, null, null);
            expect(result.tier).toBeNull();
            expect(result.points).toBe(0);
        });

        test('Same inputs always produce same output (deterministic)', () => {
            const user = { phoneVerified: true, emailVerified: true };
            const r1 = computeVerificationProfile(user, null, null);
            const r2 = computeVerificationProfile(user, null, null);
            expect(r1.points).toBe(r2.points);
            expect(r1.tier).toBe(r2.tier);
            expect(r1.badges).toEqual(r2.badges);
        });
    });

    describe('computeVerificationProfile — Employer', () => {
        test('GST verified employer gains business_verified badge', () => {
            const result = computeVerificationProfile(
                { phoneVerified: true, emailVerified: true },
                null,
                { gstVerified: true, totalHires: 10 }
            );
            expect(result.badges).toContain('business_verified');
            expect(result.badges).toContain('hiring_history_verified');
        });

        test('Employer with all verifications gets Gold+', () => {
            const result = computeVerificationProfile(
                { phoneVerified: true, emailVerified: true, govIdVerified: true },
                null,
                { gstVerified: true, companyEmailVerified: true, officeLocationVerified: true, totalHires: 10 }
            );
            expect(result.points).toBeGreaterThanOrEqual(70);
        });
    });

    describe('Security: No frontend spoofing', () => {
        test('Tier is derived from server inputs, not passed in as parameter', () => {
            // The function takes user/workerProfile/employerProfile — not a tier field
            const result = computeVerificationProfile({ phoneVerified: false }, null, null);
            // Even if someone tried to pass tier in user object, it has no effect
            const maliciousUser = { phoneVerified: false, tier: 'Verified Pro' };
            const maliciousResult = computeVerificationProfile(maliciousUser, null, null);
            expect(maliciousResult.tier).toBeNull();
            expect(maliciousResult.points).toBe(0);
        });
    });
});
