'use strict';
/**
 * blockEMediumPriority.test.js
 * Tests for medium-priority BLOCK E feature add-ons:
 *  - #10 Dark Mode
 *  - #54 Swipe Undo
 *  - #61 Boost Job
 *  - #6  Job Recommendations (history-based)
 */

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../models/userModel', () => ({
    findById: jest.fn(() => ({
        select: jest.fn(() => ({ lean: jest.fn(async () => ({ preferences: { theme: 'system' } })) })),
    })),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(() => ({
        sort: jest.fn(() => ({
            limit: jest.fn(() => ({
                select: jest.fn(() => ({
                    lean: jest.fn(async () => [
                        { _id: 'job1', title: 'React Dev', companyName: 'Acme', skills: ['React', 'Node.js'], location: 'mumbai' },
                        { _id: 'job2', title: 'DevOps Eng', companyName: 'TechCo', skills: ['Docker', 'Kubernetes'], location: 'bengaluru' },
                    ]),
                })),
            })),
        })),
    })),
    findOne: jest.fn(async ({ _id }) => {
        if (_id === 'closed_job') return null;
        return {
            _id,
            employer: 'emp1',
            isOpen: true,
            updateOne: jest.fn(),
        };
    }),
    findById: jest.fn(async (id) => ({
        _id: id,
        select: jest.fn(() => ({
            lean: jest.fn(async () => ({
                isBoosted: false,
                boostTier: null,
                boostExpiresAt: null,
                boostSortWeight: 0,
            })),
        })),
    })),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    countDocuments: jest.fn(async () => 0),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(() => ({
        select: jest.fn(() => ({
            lean: jest.fn(async () => ({
                skills: ['React', 'Node.js', 'MongoDB'],
                location: 'mumbai',
                availability: 'full_time',
                geo: null,
            })),
        })),
    })),
}));

// ── Services ──────────────────────────────────────────────────────────────────
const { setThemePreference, getThemePreference, VALID_THEMES } = require('../services/darkModeService');
const { pushUndoAction, peekLastAction, consumeUndoAction, clearUndoStack, UNDO_WINDOW_MS } = require('../services/undoActionService');
const { getHistoryBasedRecommendations, getResumeBasedRecommendations } = require('../services/jobRecommendationService');
const { boostJob, clearBoost, BOOST_TIERS } = require('../services/boostJobService');

const USER_A = 'user_undo_test';

// ════════════════════════════════════════════════════════════════════════════
describe('BLOCK E Medium Priority — Feature Add-on Tests', () => {

    // ── #10: Dark Mode ────────────────────────────────────────────────────
    describe('#10 Dark Mode Service', () => {
        it('VALID_THEMES contains system, light, dark', () => {
            expect(VALID_THEMES).toContain('system');
            expect(VALID_THEMES).toContain('light');
            expect(VALID_THEMES).toContain('dark');
        });

        it('setThemePreference accepts valid themes', async () => {
            for (const theme of VALID_THEMES) {
                const result = await setThemePreference('u1', theme);
                expect(result.theme).toBe(theme);
            }
        });

        it('setThemePreference rejects invalid theme', async () => {
            await expect(setThemePreference('u1', 'rainbow')).rejects.toMatchObject({
                message: expect.stringContaining('Invalid theme'),
            });
        });

        it('getThemePreference returns system as default', async () => {
            const result = await getThemePreference('u1');
            expect(result.theme).toBe('system');
        });
    });

    // ── #54: Swipe Undo ────────────────────────────────────────────────────
    describe('#54 Swipe Undo Service', () => {
        beforeEach(() => clearUndoStack(USER_A));

        it('pushUndoAction returns actionId and undoWindowMs', () => {
            const result = pushUndoAction(USER_A, { actionType: 'job_apply', payload: { jobId: 'job1' } });
            expect(result).toHaveProperty('actionId');
            expect(result.undoWindowMs).toBe(UNDO_WINDOW_MS);
        });

        it('peekLastAction returns last action within window', () => {
            pushUndoAction(USER_A, { actionType: 'save_job', payload: { jobId: 'job2' } });
            const action = peekLastAction(USER_A);
            expect(action).not.toBeNull();
            expect(action.actionType).toBe('save_job');
            expect(action.remainingMs).toBeGreaterThan(0);
        });

        it('peekLastAction returns null when stack is empty', () => {
            expect(peekLastAction(USER_A)).toBeNull();
        });

        it('consumeUndoAction returns and removes the action', () => {
            const push = pushUndoAction(USER_A, { actionType: 'follow_company', payload: {} });
            const consumed = consumeUndoAction(USER_A, push.actionId);
            expect(consumed).not.toBeNull();
            expect(consumed.actionType).toBe('follow_company');
            // Stack should now be empty
            expect(peekLastAction(USER_A)).toBeNull();
        });

        it('consumeUndoAction returns null for unknown actionId', () => {
            pushUndoAction(USER_A, { actionType: 'job_apply', payload: {} });
            expect(consumeUndoAction(USER_A, 'nonexistent')).toBeNull();
        });

        it('stack is LIFO — most recent action is on top', () => {
            pushUndoAction(USER_A, { actionType: 'step1', payload: {} });
            pushUndoAction(USER_A, { actionType: 'step2', payload: {} });
            const top = peekLastAction(USER_A);
            expect(top.actionType).toBe('step2');
        });
    });

    // ── #6: History-Based Recommendations ────────────────────────────────
    describe('#6 History-Based Job Recommendations', () => {
        it('returns an array of recommendations', async () => {
            const results = await getHistoryBasedRecommendations('user1');
            expect(Array.isArray(results)).toBe(true);
        });

        it('each result has recommendationSource = history_profile', async () => {
            const results = await getHistoryBasedRecommendations('user1');
            results.forEach((r) => expect(r.recommendationSource).toBe('history_profile'));
        });

        it('each result has matchedSkills array', async () => {
            const results = await getHistoryBasedRecommendations('user1');
            results.forEach((r) => expect(Array.isArray(r.matchedSkills)).toBe(true));
        });
    });

    // ── #83: Resume-Based Recommendations ────────────────────────────────
    describe('#83 Resume-Based AI Job Recommendations', () => {
        it('falls back to history when no skills given', async () => {
            const results = await getResumeBasedRecommendations('user1', []);
            expect(Array.isArray(results)).toBe(true);
        });

        it('sorts by overlapScore descending', async () => {
            const results = await getResumeBasedRecommendations('user1', ['React', 'Node.js', 'MongoDB', 'Docker']);
            if (results.length > 1) {
                expect(results[0].overlapScore).toBeGreaterThanOrEqual(results[1].overlapScore);
            }
        });

        it('labels recommendationSource as resume_ai', async () => {
            const results = await getResumeBasedRecommendations('user1', ['React']);
            results.forEach((r) => expect(r.recommendationSource).toBe('resume_ai'));
        });
    });

    // ── #61: Boost Job Listing ────────────────────────────────────────────
    describe('#61 Boost Job Listing', () => {
        it('BOOST_TIERS defines standard, pro, premium', () => {
            expect(BOOST_TIERS).toHaveProperty('standard');
            expect(BOOST_TIERS).toHaveProperty('pro');
            expect(BOOST_TIERS).toHaveProperty('premium');
        });

        it('each tier has durationDays and sortWeight', () => {
            Object.values(BOOST_TIERS).forEach((tier) => {
                expect(tier.durationDays).toBeGreaterThan(0);
                expect(tier.sortWeight).toBeGreaterThan(0);
            });
        });

        it('premium has longer duration than standard', () => {
            expect(BOOST_TIERS.premium.durationDays).toBeGreaterThan(BOOST_TIERS.standard.durationDays);
        });

        it('premium has higher sortWeight than standard', () => {
            expect(BOOST_TIERS.premium.sortWeight).toBeGreaterThan(BOOST_TIERS.standard.sortWeight);
        });

        it('boostJob rejects invalid tier', async () => {
            await expect(boostJob('job1', 'emp1', 'ultra')).rejects.toMatchObject({
                message: expect.stringContaining('Invalid boost tier'),
            });
        });

        it('clearBoost returns cleared: true', async () => {
            const result = await clearBoost('job1');
            expect(result).toHaveProperty('cleared', true);
        });
    });
});
