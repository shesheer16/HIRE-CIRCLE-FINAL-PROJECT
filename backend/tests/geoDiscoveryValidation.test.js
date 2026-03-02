'use strict';

/**
 * geoDiscoveryValidation.test.js
 *
 * Verifies that the Geo Engine (Phase 30 + Phase 35 hardening):
 * 1. Correctly normalizes raw lng/lat inputs.
 * 2. Rejects out-of-bounds coordinates (returns null for invalid).
 * 3. Safely constructs $near queries for the 2dsphere index.
 * 4. Returns null (not Null Island query) for 0,0 or NaN inputs.
 */

const { normalizeCoordinates, buildNearQuery, isValidGeoCoordinate } = require('../services/geoDiscoveryService');
const Job = require('../models/Job');

describe('Geo Discovery Validation Integrity', () => {

    describe('Coordinate Normalization (Phase 35 hardened: invalid → null)', () => {
        test('Accepts valid coordinates (NYC)', () => {
            const coords = normalizeCoordinates([-74.0060, 40.7128]);
            expect(coords).toEqual([-74.0060, 40.7128]);
        });

        test('Accepts valid coordinates (Mumbai)', () => {
            const coords = normalizeCoordinates([72.877, 19.076]);
            expect(coords).toEqual([72.877, 19.076]);
        });

        test('Rejects out-of-bounds latitude > 90 → returns null', () => {
            const coords = normalizeCoordinates([0, 100]);
            expect(coords).toBeNull();
        });

        test('Rejects out-of-bounds longitude < -180 → returns null', () => {
            const coords = normalizeCoordinates([-200, 0]);
            expect(coords).toBeNull();
        });

        test('Rejects non-numeric noise → returns null', () => {
            const coords = normalizeCoordinates(['abc', null]);
            expect(coords).toBeNull();
        });

        test('Rejects arrays of wrong length → returns null', () => {
            const coords = normalizeCoordinates([10]);
            expect(coords).toBeNull();
        });

        test('Rejects 0,0 (Null Island guard)', () => {
            const coords = normalizeCoordinates([0, 0]);
            expect(coords).toBeNull();
        });
    });

    describe('isValidGeoCoordinate', () => {
        test('valid real-world coordinate → true', () => {
            expect(isValidGeoCoordinate(19.076, 72.877)).toBe(true);
        });

        test('0,0 → false (Null Island)', () => {
            expect(isValidGeoCoordinate(0, 0)).toBe(false);
        });

        test('NaN lat → false', () => {
            expect(isValidGeoCoordinate(NaN, 72.877)).toBe(false);
        });

        test('out-of-range lat > 90 → false', () => {
            expect(isValidGeoCoordinate(91, 72.877)).toBe(false);
        });

        test('out-of-range lng > 180 → false', () => {
            expect(isValidGeoCoordinate(19, 181)).toBe(false);
        });
    });

    describe('MongoDB $near Query Construction (Phase 35 hardened)', () => {
        test('Builds valid $near query with maxDistance in meters for SF', () => {
            // Note: buildNearQuery(lat, lng, radius) — lat first
            const query = buildNearQuery(37.7749, -122.4194, 10); // SF, 10km
            expect(query).not.toBeNull();
            expect(query).toHaveProperty('geo.$near');
            expect(query.geo.$near.$geometry.type).toBe('Point');
            expect(query.geo.$near.$geometry.coordinates).toEqual([-122.4194, 37.7749]);
            expect(query.geo.$near.$maxDistance).toBe(10000); // 10km in meters
        });

        test('Returns null for 0,0 (Phase 35 — no Null Island queries)', () => {
            const query = buildNearQuery(0, 0, 25);
            expect(query).toBeNull();
        });

        test('Returns null for NaN lat', () => {
            const query = buildNearQuery(NaN, 72.877, 25);
            expect(query).toBeNull();
        });

        test('Defaults to 25km radius for valid coordinates', () => {
            const query = buildNearQuery(19.076, 72.877);
            expect(query).not.toBeNull();
            expect(query.geo.$near.$maxDistance).toBe(25000);
        });

        test('Clamps radius to 1km minimum', () => {
            const query = buildNearQuery(19.076, 72.877, 0);
            expect(query).not.toBeNull();
            expect(query.geo.$near.$maxDistance).toBe(1000); // 1km minimum
        });

        test('Clamps radius to 500km maximum', () => {
            const query = buildNearQuery(19.076, 72.877, 9999);
            expect(query).not.toBeNull();
            expect(query.geo.$near.$maxDistance).toBe(500000); // 500km max
        });
    });

    describe('Job Schema Pre-Save Hook', () => {
        test('Validates geo point on a new Job initialization', async () => {
            const job = new Job({
                employerId: '60d5ecb54d62b1001f3e1a12',
                title: 'Driver',
                companyName: 'Logistics Co',
                salaryRange: '100-200',
                location: 'NYC',
                geo: {
                    coordinates: [-250, 95] // Completely invalid
                }
            });

            // Trigger the async pre-validate hook
            try {
                await job.validate();
            } catch (e) {
                // ignore other missing fields for this focused test
            }

            // Should fallback to [0,0] because hook intercepts it at schema level
            expect(job.geo.coordinates).toEqual([0, 0]);
        });
    });
});
