'use strict';
/**
 * engagementRetention.test.js
 * Comprehensive tests for Features 31-60
 * Engagement & Retention Block
 */

describe('Engagement & Retention Block (Features 31-60)', () => {

    // ════════════════════════════════════════════════════════════════════════════
    // Features 32, 33, 50, 56 — Badges & Milestones
    // ════════════════════════════════════════════════════════════════════════════
    describe('engagementBadgesService', () => {
        const { computeLoginStreak, evaluateUserBadges, checkConfettiTrigger, computeAppIconBadgeCount, BADGES } = require('../services/engagementBadgesService');

        test('computeLoginStreak returns correct streak', () => {
            const today = new Date();
            const yday = new Date(today); yday.setDate(yday.getDate() - 1);
            const dby = new Date(today); dby.setDate(dby.getDate() - 2);
            expect(computeLoginStreak([today, yday, dby])).toBe(3);
        });

        test('computeLoginStreak returns 0 if broken', () => {
            const today = new Date();
            const old = new Date(today); old.setDate(old.getDate() - 4);
            expect(computeLoginStreak([old])).toBe(0);
        });

        test('evaluateUserBadges returns first apply & interview', () => {
            const result = evaluateUserBadges({ applicationsCount: 1, interviewsCount: 1, loginDates: [] });
            expect(result.earned).toContain(BADGES.first_apply);
            expect(result.earned).toContain(BADGES.first_interview);
        });

        test('checkConfettiTrigger triggers on new milestone', () => {
            expect(checkConfettiTrigger({ applicationsCount: 0 }, { applicationsCount: 1 })).toBe(true);
            expect(checkConfettiTrigger({ applicationsCount: 1 }, { applicationsCount: 2 })).toBe(false);
        });

        test('computeAppIconBadgeCount sums unseen items', () => {
            expect(computeAppIconBadgeCount(2, 3, 1)).toBe(6);
            expect(computeAppIconBadgeCount(0, 0, 0)).toBe(0);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 34, 35, 39, 40, 41 — Notification Scheduling
    // ════════════════════════════════════════════════════════════════════════════
    describe('notificationSchedulingService', () => {
        const { isJobClosingSoon, shouldSendReunlockReminder, buildMilestoneNotification, generateCalendarLink } = require('../services/notificationSchedulingService');

        test('isJobClosingSoon returns true for <48h', () => {
            const soon = new Date(); soon.setHours(soon.getHours() + 24);
            expect(isJobClosingSoon(soon)).toBe(true);
        });

        test('isJobClosingSoon returns false for >48h', () => {
            const far = new Date(); far.setDate(far.getDate() + 5);
            expect(isJobClosingSoon(far)).toBe(false);
        });

        test('shouldSendReunlockReminder true if saved 3-4 days ago and unapplied', () => {
            const old = new Date(); old.setHours(old.getHours() - 84); // 3.5 days
            expect(shouldSendReunlockReminder(old, false)).toBe(true);
            expect(shouldSendReunlockReminder(old, true)).toBe(false);
        });

        test('buildMilestoneNotification returns correct text', () => {
            expect(buildMilestoneNotification('hired')).toContain('Congratulations');
            expect(buildMilestoneNotification('reviewed')).toContain('reviewed');
            expect(buildMilestoneNotification('unknown')).toBeNull();
        });

        test('generateCalendarLink builds basic ICS', () => {
            const result = generateCalendarLink({ title: 'React Interview', startStr: 'A', endStr: 'B', description: 'C', location: 'D' });
            expect(result).toContain('BEGIN:VCALENDAR');
            expect(result).toContain('React Interview');
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 38, 43, 46, 47, 57 — Behavior Segmentation
    // ════════════════════════════════════════════════════════════════════════════
    describe('userBehaviorSegmentationService', () => {
        const { segmentUser, aggregateInterestTags, rankRetargetedJobs, buildSearchCloud, SEGMENTS } = require('../services/userBehaviorSegmentationService');

        test('segmentUser identifies active seekers and night owls', () => {
            expect(segmentUser({ lastActiveDaysAgo: 20 })).toBe(SEGMENTS.CHURN_RISK);
            expect(segmentUser({ nightActivityPct: 0.8 })).toBe(SEGMENTS.NIGHT_OWL);
            expect(segmentUser({ dailySwipes: 25, dailyApplies: 5 })).toBe(SEGMENTS.ACTIVE_SEEKER);
        });

        test('aggregateInterestTags sorts by weight', () => {
            const actions = [
                { category: 'tech', type: 'apply' },   // 3
                { category: 'retail', type: 'save' },  // 2
                { category: 'tech', type: 'view' }     // 1 = 4 total
            ];
            const tags = aggregateInterestTags(actions);
            expect(tags[0]).toBe('tech');
            expect(tags[1]).toBe('retail');
        });

        test('rankRetargetedJobs floats matched categories up', () => {
            const jobs = [{ id: 1, category: 'food' }, { id: 2, category: 'tech' }];
            const ranked = rankRetargetedJobs(jobs, ['tech']);
            expect(ranked[0].id).toBe(2);
        });

        test('buildSearchCloud generates weighted ui objects', () => {
            const searches = ['react', 'react', 'node'];
            const cloud = buildSearchCloud(searches);
            expect(cloud[0].text).toBe('react');
            expect(cloud[0].weight).toBe(20);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 42, 49, 53 — Engagement Configs
    // ════════════════════════════════════════════════════════════════════════════
    describe('userEngagementConfigService', () => {
        const { shouldQueueJobAlert, getOptimalPushHour, flagMessageImportance } = require('../services/userEngagementConfigService');

        test('shouldQueueJobAlert logic', () => {
            expect(shouldQueueJobAlert('never')).toBe(false);
            expect(shouldQueueJobAlert('instant')).toBe(true);
            expect(shouldQueueJobAlert('daily', 'high')).toBe(true);
            expect(shouldQueueJobAlert('daily', 'normal')).toBe(false);
        });

        test('getOptimalPushHour default and overrides', () => {
            expect(getOptimalPushHour('morning')).toBe(9);
            expect(getOptimalPushHour(null)).toBe(18); // Default 6 PM
        });

        test('flagMessageImportance detects role and keywords', () => {
            expect(flagMessageImportance('Hello', 'system')).toBe(true);
            expect(flagMessageImportance('You are hired!', 'user')).toBe(true);
            expect(flagMessageImportance('How are you?', 'user')).toBe(false);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 44, 45, 51, 58 — Job Card UX
    // ════════════════════════════════════════════════════════════════════════════
    describe('jobCardEngagementService', () => {
        const { computeExpiryCountdown, generateJobDeepLink, buildExitIntentSuggestions, formatSalaryRangePreview } = require('../services/jobCardEngagementService');

        test('computeExpiryCountdown formatting', () => {
            const past = new Date(); past.setHours(past.getHours() - 1);
            expect(computeExpiryCountdown(past)).toBe('Expired');

            const tomorrow = new Date(); tomorrow.setHours(tomorrow.getHours() + 25);
            expect(computeExpiryCountdown(tomorrow)).toContain('Closing in 1d');

            const far = new Date(); far.setDate(far.getDate() + 10);
            expect(computeExpiryCountdown(far)).toBeNull();
        });

        test('generateJobDeepLink creates safe URI', () => {
            const uri = generateJobDeepLink('123', 'React Dev', 'Corp & Co');
            expect(uri).toContain('hireapp://job/123');
            expect(uri).toContain('Corp%20%26%20Co');
        });

        test('buildExitIntentSuggestions takes top 2', () => {
            const sliced = buildExitIntentSuggestions([1, 2, 3, 4]);
            expect(sliced.length).toBe(2);
            expect(sliced[1]).toBe(2);
        });

        test('formatSalaryRangePreview handles K and L', () => {
            expect(formatSalaryRangePreview(15000, 25000)).toBe('₹15K - ₹25K');
            expect(formatSalaryRangePreview(200000, 300000)).toBe('₹2L - ₹3L');
            expect(formatSalaryRangePreview(10000, 10000)).toBe('₹10K');
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 31, 52, 55, 59, 60 — Unified Feedback
    // ════════════════════════════════════════════════════════════════════════════
    describe('unifiedFeedbackService', () => {
        const { shouldPromptSurvey, processNotInterestedTraining, buildJobComparison, extractDirectCallNumber, buildReferralTrackerSummary } = require('../services/unifiedFeedbackService');

        test('shouldPromptSurvey limits prompts', () => {
            expect(shouldPromptSurvey({ applies: 5, surveysTaken: 0 })).toBe(true);
            expect(shouldPromptSurvey({ applies: 6, surveysTaken: 0 })).toBe(false);
            expect(shouldPromptSurvey({ applies: 5, surveysTaken: 3 })).toBe(false); // Max reached
        });

        test('processNotInterestedTraining payload', () => {
            const p = processNotInterestedTraining('u1', 'tech');
            expect(p.userId).toBe('u1');
            expect(p.negativeCategory).toBe('tech');
            expect(p.weightModifier).toBe(-0.2);
            expect(p.timestamp).toBeInstanceOf(Date);
        });

        test('buildJobComparison maps differences', () => {
            const A = { title: 'Dev', maxSalary: 20000, distanceKm: 5 };
            const B = { title: 'Dev', maxSalary: 25000, distanceKm: 10 };
            const comp = buildJobComparison(A, B);
            expect(comp.titleMatch).toBe(true);
            expect(comp.salaryDiff).toBe(-5000);
            expect(comp.distanceDiff).toBe(-5);
        });

        test('extractDirectCallNumber strips junk', () => {
            expect(extractDirectCallNumber('+91 98765-43210')).toBe('tel:+919876543210');
            expect(extractDirectCallNumber('123')).toBeNull(); // too short
        });

        test('buildReferralTrackerSummary aggregates array', () => {
            const refs = [{ status: 'pending' }, { status: 'hired' }, { status: 'hired' }];
            const summary = buildReferralTrackerSummary(refs);
            expect(summary.totalSent).toBe(3);
            expect(summary.hired).toBe(2);
            expect(summary.totalEarningsPredicted).toBe(1000);
        });
    });

});
