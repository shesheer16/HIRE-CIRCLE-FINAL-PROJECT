'use strict';

/**
 * profileCompletionEnhancement.test.js
 * 
 * Verifies the Profile Progress Bar 2.0 conversion logic.
 * Ensures:
 * 1. Completion percentage maps exactly to existing fields.
 * 2. Visual status is computed correctly based on percent.
 * 3. The correct improvement tips are provided.
 * 4. Conversion phrasing hits psychological drivers.
 */

const { getProfileCompletionMetrics } = require('../services/profileCompletionEnhancementService');
const WorkerProfile = require('../models/WorkerProfile');

jest.mock('../models/WorkerProfile');

describe('Profile Progress Bar 2.0 Completion Enhancement', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Returns 0% and generic hints for missing profile', async () => {
        WorkerProfile.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null)
        });

        const metrics = await getProfileCompletionMetrics('user_null');

        expect(metrics.completionPercentage).toBe(0);
        expect(metrics.status).toBe('incomplete');
        expect(metrics.suggestions).toContain('Create your basic profile to start getting matches.');
    });

    test('Computes partial profile completion accurately', async () => {
        // Provide partial fields
        const partialProfile = {
            avatar: 's3://avatar.jpg',            // 15
            totalExperience: 3,                   // 10
            language: null,                       // 0
            licenses: [],                         // 0
            videoIntroduction: { videoUrl: '' },  // 0
            roleProfiles: [{ roleName: 'Chef' }], // 20
            interviewVerified: false              // 0
            // Total: 45 expected from keys above.
            // Wait, let's trace:
            // avatar: 15
            // roleProfiles: 20
            // totalExperience: 10
            // language: 5 (missing)
            // licenses: 10 (missing)
            // videoIntroduction: 20 (missing)
            // interviewVerified: 20 (missing)
            // Total weights: 15+20+10+5+10+20+20 = 100
        };

        WorkerProfile.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(partialProfile)
        });

        const metrics = await getProfileCompletionMetrics('user_partial');

        expect(metrics.completionPercentage).toBe(45);
        expect(metrics.visualStatus).toBe('fair');
        expect(metrics.suggestions.length).toBe(4); // Missed 4 fields
        expect(metrics.conversionHints[0]).toContain('Your low completion rate is hiding you');
    });

    test('Computes fully 100% completed profile accurately', async () => {
        const fullProfile = {
            avatar: 's3://avatar.jpg',
            totalExperience: 5,
            language: 'English',
            licenses: ['Drive'],
            videoIntroduction: { videoUrl: 's3://video.mp4' },
            roleProfiles: [{ roleName: 'Chef' }],
            interviewVerified: true
        };

        WorkerProfile.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(fullProfile)
        });

        const metrics = await getProfileCompletionMetrics('user_full');

        expect(metrics.completionPercentage).toBe(100);
        expect(metrics.visualStatus).toBe('excellent');
        expect(metrics.suggestions.length).toBe(0);
        expect(metrics.conversionHints[0]).toContain('Your profile is in the top 1%');
    });
});
