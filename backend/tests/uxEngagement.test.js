'use strict';
/**
 * uxEngagement.test.js
 * Comprehensive tests for Features 1-30
 * UX & Engagement Block
 */

describe('UX & Engagement Block (Features 1-30)', () => {

    // ════════════════════════════════════════════════════════════════════════════
    // Features 4, 5, 11, 21, 27 — UI Interactions
    // ════════════════════════════════════════════════════════════════════════════
    describe('uiInteractionService', () => {
        const { interpretSwipeAction, handleShakeGesture, getMicroInteractionConfig } = require('../services/uiInteractionService');

        test('interpretSwipeAction maps directions', () => {
            expect(interpretSwipeAction('left', 3).action).toBe('skip');
            expect(interpretSwipeAction('left', 3).confidence).toBe('high');
            expect(interpretSwipeAction('right', 1, false).action).toBe('save'); // Card view
            expect(interpretSwipeAction('right', 1, true).action).toBe('apply'); // List view
        });

        test('handleShakeGesture returns random job', () => {
            const jobs = [{ id: 1 }, { id: 2 }];
            const result = handleShakeGesture(jobs);
            expect(result.animation).toBe('shake_reveal');
            expect(result.job).toBeDefined();
            expect(handleShakeGesture([])).toBeNull();
        });

        test('getMicroInteractionConfig provides payload', () => {
            const conf = getMicroInteractionConfig();
            expect(conf.pullToRefreshState).toBe('hub_spinner_active');
            expect(conf.reactions.length).toBeGreaterThan(0);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 1, 2, 3, 9, 12, 13 — Job Discovery UI Map
    // ════════════════════════════════════════════════════════════════════════════
    describe('jobDiscoveryUiService', () => {
        const { getRadiusSliderConfig, buildHeatmapClusters, evaluateTravelEtaLimit, buildMapPinPayload, getSearchPresets } = require('../services/jobDiscoveryUiService');

        test('getRadiusSliderConfig adapts to city density', () => {
            expect(getRadiusSliderConfig(true).defaultValue).toBe(5);
            expect(getRadiusSliderConfig(false).defaultValue).toBe(25);
        });

        test('buildHeatmapClusters groups jobs', () => {
            const jobs = [
                { location: { coordinates: [77.592, 12.971] }, isUrgent: true },
                { location: { coordinates: [77.594, 12.974] }, isUrgent: false }, // Round to '77.59,12.97' at precision 2
                { location: { coordinates: [80.27, 13.08] } } // Different
            ];
            const clusters = buildHeatmapClusters(jobs, 2);
            expect(clusters.length).toBe(2);
            const blr = clusters.find(c => c.count === 2);
            expect(blr.urgencyWeight).toBe(3); // 2 + 1
            expect(blr.heatIntensity).toBe(30);
        });

        test('evaluateTravelEtaLimit maps mins to words', () => {
            expect(evaluateTravelEtaLimit(10)).toContain('<15m');
            expect(evaluateTravelEtaLimit(45)).toContain('<1h');
            expect(evaluateTravelEtaLimit(90)).toContain('>1h');
        });

        test('buildMapPinPayload validates payload', () => {
            const result = buildMapPinPayload({ _id: '123', title: 'Driver', maxSalary: 500 });
            expect(result.id).toBe('123');
            expect(result.draggable).toBe(true);
            expect(buildMapPinPayload(null)).toBeNull();
        });

        test('getSearchPresets returns basic array', () => {
            const presets = getSearchPresets();
            expect(presets[0].id).toBe('high_pay');
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 14, 16, 22, 28, 29, 30 — Profile UI / Uploads
    // ════════════════════════════════════════════════════════════════════════════
    describe('profileEngagementUiService', () => {
        const { suggestSkillsFromText, analyzeProfileBio, generateCompletionMicrocopy, formatUploadProgress } = require('../services/profileEngagementUiService');

        test('suggestSkillsFromText matches keywords', () => {
            const skills = suggestSkillsFromText('I am a delivery driver');
            expect(skills).toContain('Driving License');
        });

        test('analyzeProfileBio scores text', () => {
            expect(analyzeProfileBio('short').score).toBe(30);
            expect(analyzeProfileBio('This bio is long enough but lacks e_xperience word').score).toBe(60);
            expect(analyzeProfileBio('I have 5 years of experience driving trucks').score).toBe(90);
        });

        test('generateCompletionMicrocopy ramps up', () => {
            expect(generateCompletionMicrocopy(10)).toContain('basics');
            expect(generateCompletionMicrocopy(50)).toContain('halfway');
            expect(generateCompletionMicrocopy(100)).toContain('All-Star');
        });

        test('formatUploadProgress returns UI state', () => {
            const prog = formatUploadProgress(500, 1000);
            expect(prog.percent).toBe(50);
            expect(prog.status).toBe('uploading');
            expect(formatUploadProgress(1000, 1000).status).toBe('complete');
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 15, 23, 25 — Hardware / Biometrics
    // ════════════════════════════════════════════════════════════════════════════
    describe('hardwareIntegrationUiService', () => {
        const { evaluateCommuteAlert, validateBiometricPayload, normalizeVoiceSearch } = require('../services/hardwareIntegrationUiService');

        test('evaluateCommuteAlert identifies major movements', () => {
            const oldLoc = { lat: 10, lng: 10 };
            const newLoc = { lat: 10.5, lng: 10 }; // big move
            const smallLoc = { lat: 10.01, lng: 10.01 }; // small move

            expect(evaluateCommuteAlert(oldLoc, newLoc).triggerAlert).toBe(true);
            expect(evaluateCommuteAlert(oldLoc, smallLoc).triggerAlert).toBe(false);
        });

        test('validateBiometricPayload enforces tokens', () => {
            expect(() => validateBiometricPayload(null, 'device')).toThrow('Missing');
            expect(validateBiometricPayload('token', 'device').authenticated).toBe(true);
        });

        test('normalizeVoiceSearch strips filler words', () => {
            expect(normalizeVoiceSearch('um find me some delivery jobs')).toBe('some delivery');
            expect(normalizeVoiceSearch('like looking for tech')).toBe('tech');
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 17, 18, 20 — Saved Searches & Alerts
    // ════════════════════════════════════════════════════════════════════════════
    describe('savedSearchAlertService', () => {
        const { createSavedSearchAlert, evaluateGeoAlertTrigger, buildDailyDigestWidget } = require('../services/savedSearchAlertService');

        test('createSavedSearchAlert builds format', () => {
            const alert = createSavedSearchAlert('driver', { maxDistance: 10, coordinates: [0, 0] }, 'u1');
            expect(alert.geoConstraint).toBe(true);
            expect(() => createSavedSearchAlert('', {}, 'u1')).toThrow();
        });

        test('evaluateGeoAlertTrigger checks distance', () => {
            const alert = { geoConstraint: true, filters: { coordinates: [0, 0], maxDistance: 10 } };
            const farJob = { location: { coordinates: [1, 1] } }; // ~150km out
            const nearJob = { location: { coordinates: [0.05, 0.05] } }; // < 10km

            expect(evaluateGeoAlertTrigger(farJob, alert)).toBe(false);
            expect(evaluateGeoAlertTrigger(nearJob, alert)).toBe(true);
        });

        test('buildDailyDigestWidget sorts by salary', () => {
            const jobs = [{ _id: 1, maxSalary: 100 }, { _id: 2, maxSalary: 1000 }, { _id: 3, maxSalary: 50 }];
            const w = buildDailyDigestWidget('u1', jobs);
            expect(w.topPicks[0].id).toBe(2);
            expect(w.topPicks.length).toBe(3);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Features 8, 19, 24, 26 — Quick Actions & FAB
    // ════════════════════════════════════════════════════════════════════════════
    describe('quickActionUiService', () => {
        const { getAssessmentLink, getSkeletonConfig, validateOneTapAccept, determineFabContext } = require('../services/quickActionUiService');

        test('getAssessmentLink validates https', () => {
            expect(getAssessmentLink({ requirements: { assessmentUrl: 'https://test.com' } })).toBe('https://test.com');
            expect(getAssessmentLink({ requirements: { assessmentUrl: 'http://bad.com' } })).toBeNull();
        });

        test('getSkeletonConfig returns payload', () => {
            expect(getSkeletonConfig('list').type).toBe('bars');
            expect(getSkeletonConfig('card').type).toBe('profile_card');
        });

        test('validateOneTapAccept enforces biometric', () => {
            expect(() => validateOneTapAccept('o1', 'u1', null)).toThrow('biometric');
            expect(validateOneTapAccept('o1', 'u1', 'token').action).toBe('CONFIRM');
        });

        test('determineFabContext maps screen logic', () => {
            expect(determineFabContext('home', 'employer').action).toBe('create_job');
            expect(determineFabContext('home', 'talent').action).toBe('toggle_map');
            expect(determineFabContext('settings', 'talent')).toBeNull();
        });
    });

});
