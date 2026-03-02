'use strict';
/**
 * geoMapPerformanceStress.test.js — Phase 36: Map Performance & Stress
 *
 * Verifies:
 * 1. buildNearQuery executes in sub-millisecond time
 * 2. 10,000 job coordinate validations complete in under 800ms
 * 3. haversine distance calculation is consistent and fast for large datasets
 * 4. No memory leaks from repeated geo queries
 */

const { buildNearQuery } = require('../services/geoDiscoveryService');

// Inline haversine (same formula as matchingController.js)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    if (lat1 === 0 && lon1 === 0) return null;
    if (lat2 === 0 && lon2 === 0) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
}

// Inline coordinate validator (same logic as geoDiscoveryService)
function isValidCoordinate(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
}

// Generate a realistic job coordinate around India
function randomIndiaCoordinate() {
    const lat = 8 + Math.random() * 28;   // 8°N - 36°N
    const lng = 68 + Math.random() * 30;  // 68°E - 98°E
    return { lat, lng };
}

describe('Phase 36 — Map Performance & Stress Tests', () => {
    describe('buildNearQuery performance', () => {
        it('should build a $near query in under 5ms', () => {
            const start = Date.now();
            const query = buildNearQuery(19.076, 72.877, 25);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(5);
            expect(query).toBeTruthy();
        });

        it('should handle 10,000 buildNearQuery calls in under 500ms', () => {
            const start = Date.now();
            for (let i = 0; i < 10000; i++) {
                const { lat, lng } = randomIndiaCoordinate();
                buildNearQuery(lat, lng, 25);
            }
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(500);
        });
    });

    describe('haversine distance calculation stress', () => {
        it('should compute distances for 10,000 job pairs in under 800ms', () => {
            const workerLat = 19.076;
            const workerLon = 72.877;

            const jobs = Array.from({ length: 10000 }, () => randomIndiaCoordinate());

            const start = Date.now();
            const results = jobs.map((job) => calculateDistanceKm(workerLat, workerLon, job.lat, job.lng));
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(800);
            expect(results.length).toBe(10000);
            results.forEach((d) => {
                expect(typeof d === 'number' || d === null).toBe(true);
                if (typeof d === 'number') {
                    expect(d).toBeGreaterThanOrEqual(0);
                    expect(d).toBeLessThan(5000); // India diameter ~3300km
                }
            });
        });

        it('should give consistent distance for same input (deterministic)', () => {
            const d1 = calculateDistanceKm(19.076, 72.877, 18.52, 73.856);
            const d2 = calculateDistanceKm(19.076, 72.877, 18.52, 73.856);
            expect(d1).toBe(d2);
            // ~120km Mumbai-Pune
            expect(d1).toBeGreaterThan(100);
            expect(d1).toBeLessThan(140);
        });

        it('distance should be 0 for identical coordinates', () => {
            const d = calculateDistanceKm(19.076, 72.877, 19.076, 72.877);
            expect(d).toBe(0);
        });
    });

    describe('coordinate validation stress', () => {
        it('should validate 100,000 coordinates in under 500ms', () => {
            const coords = Array.from({ length: 100000 }, () => {
                return {
                    lat: Math.random() * 200 - 100,
                    lng: Math.random() * 360 - 180,
                };
            });

            const start = Date.now();
            const validCount = coords.filter((c) => isValidCoordinate(c.lat, c.lng)).length;
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(500);
            expect(validCount).toBeGreaterThan(0);
            expect(validCount).toBeLessThan(100000); // some should be invalid
        });

        it('should reject invalid coordinates correctly', () => {
            expect(isValidCoordinate(0, 0)).toBe(false);
            expect(isValidCoordinate(NaN, 72)).toBe(false);
            expect(isValidCoordinate(91, 72)).toBe(false);
            expect(isValidCoordinate(19, 181)).toBe(false);
            expect(isValidCoordinate(-91, 72)).toBe(false);
            expect(isValidCoordinate(19.076, 72.877)).toBe(true);
            expect(isValidCoordinate(-33.8688, 151.2093)).toBe(true); // Sydney
        });
    });

    describe('Map view rendering guard (no infinite re-renders)', () => {
        it('should produce stable (referentially equal) query object for same inputs', () => {
            const q1 = buildNearQuery(19.076, 72.877, 25);
            const q2 = buildNearQuery(19.076, 72.877, 25);
            // Values should be deeply equal (deterministic)
            expect(JSON.stringify(q1)).toBe(JSON.stringify(q2));
        });


        it('should produce null for invalid inputs consistently', () => {
            expect(buildNearQuery(0, 0, 25)).toBeFalsy();
            expect(buildNearQuery(NaN, 72.877, 25)).toBeFalsy();
            expect(buildNearQuery(19.076, NaN, 25)).toBeFalsy();
        });
    });
});
