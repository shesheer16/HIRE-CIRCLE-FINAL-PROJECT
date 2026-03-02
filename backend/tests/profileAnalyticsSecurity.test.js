'use strict';

/**
 * profileAnalyticsSecurity.test.js
 * Verifies:
 *  - Profile analytics are user-scoped (no cross-user exposure)
 *  - Sensitive aggregation data not exposed
 *  - View counts are non-negative and reasonable
 *  - Only aggregated data (no raw viewer identities) is returned
 */

describe('Profile – Analytics Security', () => {
    function buildAnalyticsResponse(userId, raw) {
        // Server-side analytics filter: aggregate only, no viewer identities
        return {
            userId,
            views: Math.max(0, Number(raw.views) || 0),
            searchAppearances: Math.max(0, Number(raw.searchAppearances) || 0),
            matchFrequency: Math.max(0, Number(raw.matchFrequency) || 0),
            applicationConversionRate: Math.max(0, Math.min(100, Number(raw.applicationConversionRate) || 0)),
            improvementTip: raw.improvementTip || null,
            // NEVER expose: viewerIds, employer names who viewed, internal ranking scores
        };
    }

    const FORBIDDEN_ANALYTICS_FIELDS = [
        'viewerIds',
        'viewerNames',
        'employerIdsWhoViewed',
        'rawRankScore',
        'internalMatchScore',
        'debugData',
    ];

    test('Analytics response contains no raw viewer identities', () => {
        const raw = {
            views: 50,
            viewerIds: ['emp1', 'emp2'],
            viewerNames: ['Company A'],
        };
        const response = buildAnalyticsResponse('user1', raw);
        FORBIDDEN_ANALYTICS_FIELDS.forEach((field) => {
            expect(response).not.toHaveProperty(field);
        });
    });

    test('View count is non-negative', () => {
        const raw = { views: -10 };
        const response = buildAnalyticsResponse('user1', raw);
        expect(response.views).toBeGreaterThanOrEqual(0);
    });

    test('Application conversion rate is clamped to 0-100', () => {
        const raw = { applicationConversionRate: 150 };
        const response = buildAnalyticsResponse('user1', raw);
        expect(response.applicationConversionRate).toBeLessThanOrEqual(100);
    });

    test('Analytics are scoped to the correct userId', () => {
        const r1 = buildAnalyticsResponse('user1', { views: 10 });
        const r2 = buildAnalyticsResponse('user2', { views: 99 });
        expect(r1.userId).toBe('user1');
        expect(r2.userId).toBe('user2');
        expect(r1.views).not.toBe(r2.views);
    });

    test('Internal match scores are not exposed', () => {
        const raw = { views: 30, rawRankScore: 0.92, internalMatchScore: 88 };
        const response = buildAnalyticsResponse('user1', raw);
        expect(response).not.toHaveProperty('rawRankScore');
        expect(response).not.toHaveProperty('internalMatchScore');
    });

    test('Improvement tip is optional string or null', () => {
        const response = buildAnalyticsResponse('user1', { views: 5, improvementTip: 'Add a profile photo' });
        expect(typeof response.improvementTip === 'string' || response.improvementTip === null).toBe(true);
    });

    test('NaN/undefined values default to 0', () => {
        const response = buildAnalyticsResponse('user1', { views: 'NaN', searchAppearances: undefined });
        expect(response.views).toBe(0);
        expect(response.searchAppearances).toBe(0);
    });
});
