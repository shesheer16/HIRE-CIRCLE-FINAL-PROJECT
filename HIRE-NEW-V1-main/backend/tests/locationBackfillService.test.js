const {
    buildPatch,
    inferStructuredLocationFromLegacy,
} = require('../services/locationBackfillService');

describe('locationBackfillService', () => {
    it('infers district and mandal from legacy worker city', () => {
        const inferred = inferStructuredLocationFromLegacy({
            city: 'Madanapalle',
            district: '',
            mandal: '',
            panchayat: '',
        });

        expect(inferred).toEqual({
            district: 'Annamayya',
            mandal: 'Madanapalle',
            locationLabel: 'Madanapalle, Annamayya',
        });
    });

    it('infers structured employer location from flat location string', () => {
        const inferred = inferStructuredLocationFromLegacy({
            location: 'Rajahmundry, East Godavari',
        });

        expect(inferred).toEqual({
            district: 'East Godavari',
            mandal: 'Rajahmundry',
            locationLabel: 'Rajahmundry, East Godavari',
        });
    });

    it('builds a job patch without dropping legacy location text', () => {
        const patch = buildPatch({
            location: 'Kuppam',
            district: '',
            mandal: '',
            locationLabel: '',
        }, 'job');

        expect(patch).toEqual({
            district: 'Chittoor',
            mandal: 'Kuppam',
            locationLabel: 'Kuppam, Chittoor',
            location: 'Kuppam',
        });
    });
});
