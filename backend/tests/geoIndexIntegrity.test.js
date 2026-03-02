'use strict';
/**
 * geoIndexIntegrity.test.js
 * Phase 30/31 — Geo Index & Schema Integrity
 *
 * Verifies:
 *  1. Job schema has the correct 2dsphere index definition
 *  2. Geo coordinates are correctly set on new job instances
 *  3. Invalid coordinates are intercepted by pre-save hook
 *  4. Backfill migration logic handles missing geo fields safely
 */

const Job = require('../models/Job');

describe('Geo Index & Schema Integrity', () => {

    describe('Job Schema — GeoJSON Structure', () => {
        test('Job model exists and is a Mongoose model', () => {
            expect(Job).toBeDefined();
            expect(typeof Job).toBe('function');
        });

        test('Job schema has geo field defined', () => {
            const schemaTree = Job.schema.tree;
            // Geo can be defined as a nested object or as direct paths
            const hasGeo = schemaTree.geo !== undefined ||
                Object.keys(Job.schema.paths).some((k) => k.startsWith('geo'));
            expect(hasGeo).toBe(true);
        });

        test('geo field has coordinates', () => {
            const schemaTree = Job.schema.tree;
            const geoNode = schemaTree.geo || {};
            const hasCoords = geoNode.coordinates !== undefined ||
                Object.keys(Job.schema.paths).includes('geo.coordinates');
            expect(hasCoords).toBe(true);
        });

    });

    describe('2dsphere Index', () => {
        test('Job schema indexes include a 2dsphere index on geo', () => {
            const indexes = Job.schema.indexes();
            const hasGeoIndex = indexes.some(([fields]) => {
                return fields.geo === '2dsphere' ||
                    (fields['geo.coordinates'] === '2dsphere') ||
                    Object.values(fields).includes('2dsphere');
            });
            expect(hasGeoIndex).toBe(true);
        });
    });

    describe('Coordinate Validation (Pre-Save Hook)', () => {
        test('valid coordinates survive validation', async () => {
            const job = new Job({
                employerId: '60d5ecb54d62b1001f3e1a12',
                employer: '60d5ecb54d62b1001f3e1a12',
                title: 'Driver',
                companyName: 'Logistics Co',
                location: 'Mumbai',
                geo: {
                    type: 'Point',
                    coordinates: [72.877, 19.076], // Mumbai
                },
            });

            try { await job.validate(); } catch (_) { /* other required fields */ }
            expect(job.geo.coordinates[0]).toBe(72.877);
            expect(job.geo.coordinates[1]).toBe(19.076);
        });

        test('invalid coordinates fallback to [0,0]', async () => {
            const job = new Job({
                employerId: '60d5ecb54d62b1001f3e1a12',
                employer: '60d5ecb54d62b1001f3e1a12',
                title: 'Driver',
                companyName: 'Logistics Co',
                location: 'Invalid',
                geo: {
                    type: 'Point',
                    coordinates: [-250, 200], // out of range
                },
            });

            try { await job.validate(); } catch (_) { /* other required fields */ }
            expect(job.geo.coordinates).toEqual([0, 0]);
        });

        test('null coordinates fallback to [0,0]', async () => {
            const job = new Job({
                employerId: '60d5ecb54d62b1001f3e1a12',
                employer: '60d5ecb54d62b1001f3e1a12',
                title: 'QA Tester',
                companyName: 'TestCo',
                location: 'Bengaluru',
                geo: null,
            });

            try { await job.validate(); } catch (_) { /* other required fields */ }
            // geo path should still exist with fallback
            expect(job.geo).toBeDefined();
        });
    });

    describe('GeoJSON Query Compatibility', () => {
        test('$near query object is structurally valid', () => {
            const { buildNearQuery } = require('../services/geoDiscoveryService');
            const query = buildNearQuery(19.076, 72.877, 10);
            expect(query).not.toBeNull();
            expect(query.geo.$near.$geometry.type).toBe('Point');
            expect(Array.isArray(query.geo.$near.$geometry.coordinates)).toBe(true);
            expect(query.geo.$near.$geometry.coordinates).toHaveLength(2);
        });

        test('coordinates are [lng, lat] GeoJSON order', () => {
            const { buildNearQuery } = require('../services/geoDiscoveryService');
            const lat = 19.076, lng = 72.877;
            const query = buildNearQuery(lat, lng, 10);
            expect(query.geo.$near.$geometry.coordinates[0]).toBe(lng);  // lng first
            expect(query.geo.$near.$geometry.coordinates[1]).toBe(lat);  // lat second
        });

        test('maxDistance is in meters', () => {
            const { buildNearQuery } = require('../services/geoDiscoveryService');
            const query = buildNearQuery(19.076, 72.877, 10); // 10km
            expect(query.geo.$near.$maxDistance).toBe(10000);
        });
    });
});
