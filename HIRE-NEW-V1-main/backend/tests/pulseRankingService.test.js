const {
    computeLocalityTier,
    rankPulseItemsByViewerLocation,
} = require('../services/pulseRankingService');

describe('pulseRankingService', () => {
    it('prefers same mandal and district over broader matches', () => {
        const viewerLocation = { district: 'Chittoor', mandal: 'Madanapalle' };

        expect(computeLocalityTier(viewerLocation, { district: 'Chittoor', mandal: 'Madanapalle' })).toBe(4);
        expect(computeLocalityTier(viewerLocation, { district: 'Chittoor', mandal: 'Punganur' })).toBe(2);
        expect(computeLocalityTier(viewerLocation, { district: 'Annamayya', mandal: 'Rajampet' })).toBe(0);
    });

    it('ranks urgent local jobs ahead of broader jobs with stronger engagement', () => {
        const viewerLocation = { district: 'Chittoor', mandal: 'Madanapalle' };
        const ranked = rankPulseItemsByViewerLocation({
            viewerLocation,
            items: [
                {
                    id: 'broad-job',
                    postType: 'job',
                    title: 'Broad job',
                    district: 'Visakhapatnam',
                    mandal: 'Gajuwaka',
                    engagementScore: 9,
                    interactionCount: 50,
                    createdAt: '2026-03-14T10:00:00.000Z',
                    urgent: true,
                },
                {
                    id: 'local-job',
                    postType: 'job',
                    title: 'Local job',
                    district: 'Chittoor',
                    mandal: 'Madanapalle',
                    engagementScore: 1,
                    interactionCount: 1,
                    createdAt: '2026-03-14T09:00:00.000Z',
                    urgent: true,
                },
            ],
        });

        expect(ranked.map((item) => item.id)).toEqual(['local-job', 'broad-job']);
        expect(ranked[0].localityTier).toBe(4);
        expect(ranked[0].pulseRankSource).toBe('viewer_locality');
    });
});
