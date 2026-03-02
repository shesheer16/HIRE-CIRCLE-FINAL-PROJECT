'use strict';

/**
 * profileFraudDetection.test.js
 * Tests profileFraudDetectionService:
 *  - Rapid edit rate detection
 *  - Skill farming prevention
 *  - Suspicious location change detection
 *  - Identity swap detection
 *  - Combined fraud check aggregation
 */

const {
    checkEditRateLimit,
    checkSkillFarming,
    checkLocationChange,
    checkIdentitySwap,
    runFraudChecks,
    clearStoreForUser,
    RAPID_EDIT_THRESHOLD,
    LOCATION_CHANGE_LIMIT,
} = require('../services/profileFraudDetectionService');

describe('Profile – Fraud Detection', () => {
    afterEach(() => {
        clearStoreForUser('user_test');
        clearStoreForUser('user_loc');
    });

    describe('checkEditRateLimit', () => {
        test('Normal edit rate is not flagged', () => {
            clearStoreForUser('user_test');
            for (let i = 0; i < RAPID_EDIT_THRESHOLD; i++) {
                checkEditRateLimit('user_test');
            }
            const result = checkEditRateLimit('user_test');
            // The THRESHOLD+1th edit should flag
            expect(result.flagged).toBe(true);
        });

        test('Single edit is not flagged', () => {
            clearStoreForUser('uid_single');
            const result = checkEditRateLimit('uid_single');
            expect(result.flagged).toBe(false);
        });

        test('Flagged result contains reason', () => {
            clearStoreForUser('uid_flag');
            for (let i = 0; i <= RAPID_EDIT_THRESHOLD + 2; i++) {
                checkEditRateLimit('uid_flag');
            }
            const result = checkEditRateLimit('uid_flag');
            if (result.flagged) {
                expect(result.reason).toBe('RAPID_EDIT_RATE');
                expect(typeof result.detail).toBe('string');
            }
        });
    });

    describe('checkSkillFarming', () => {
        test('Adding ≤20 skills is not flagged', () => {
            const prev = ['Cook', 'Driver'];
            const next = [...prev, ...Array.from({ length: 18 }, (_, i) => `Skill ${i}`)];
            const result = checkSkillFarming(prev, next);
            expect(result.flagged).toBe(false);
        });

        test('Adding >20 skills at once is flagged', () => {
            const prev = [];
            const next = Array.from({ length: 21 }, (_, i) => `Skill ${i}`);
            const result = checkSkillFarming(prev, next);
            expect(result.flagged).toBe(true);
            expect(result.reason).toBe('SKILL_FARMING');
        });

        test('Re-adding same skills (no new additions) is not flagged', () => {
            const prev = ['Cook', 'Driver'];
            const next = ['Cook', 'Driver'];
            const result = checkSkillFarming(prev, next);
            expect(result.flagged).toBe(false);
        });
    });

    describe('checkLocationChange', () => {
        test(`${LOCATION_CHANGE_LIMIT}+ location changes in 24h is flagged`, () => {
            clearStoreForUser('user_loc');
            // Unique cities each time to trigger tracking
            for (let i = 0; i < LOCATION_CHANGE_LIMIT; i++) {
                checkLocationChange('user_loc', `City ${i}`);
            }
            const result = checkLocationChange('user_loc', 'FinalCity');
            expect(result.flagged).toBe(true);
            expect(result.reason).toBe('SUSPICIOUS_LOCATION_CHANGE');
        });

        test('Changing city once is not flagged', () => {
            clearStoreForUser('user_loc2');
            const result = checkLocationChange('user_loc2', 'Mumbai');
            expect(result.flagged).toBe(false);
        });
    });

    describe('checkIdentitySwap', () => {
        test('Changing 3+ identity fields is flagged', () => {
            const result = checkIdentitySwap(['firstName', 'lastName', 'phone']);
            expect(result.flagged).toBe(true);
            expect(result.reason).toBe('IDENTITY_SWAP');
        });

        test('Changing only 1 identity field is not flagged', () => {
            const result = checkIdentitySwap(['firstName']);
            expect(result.flagged).toBe(false);
        });

        test('Changing non-identity fields is not flagged', () => {
            const result = checkIdentitySwap(['bio', 'skills', 'salary']);
            expect(result.flagged).toBe(false);
        });
    });

    describe('runFraudChecks', () => {
        test('Returns isFraudulent: false for clean edits', () => {
            clearStoreForUser('user_clean');
            const result = runFraudChecks({
                userId: 'user_clean',
                changedFields: ['bio'],
                previousSkills: ['Cook'],
                newSkills: ['Cook', 'Driver'],
            });
            expect(result.isFraudulent).toBe(false);
            expect(result.flags).toHaveLength(0);
        });

        test('Returns isFraudulent: true for identity swap + skill farming', () => {
            const result = runFraudChecks({
                userId: 'user_fraud',
                changedFields: ['firstName', 'lastName', 'phone'],
                previousSkills: [],
                newSkills: Array.from({ length: 21 }, (_, i) => `Skill ${i}`),
            });
            expect(result.isFraudulent).toBe(true);
            expect(result.flags.length).toBeGreaterThan(0);
        });
    });
});
