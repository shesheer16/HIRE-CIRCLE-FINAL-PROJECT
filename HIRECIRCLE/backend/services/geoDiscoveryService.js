'use strict';

/**
 * geoDiscoveryService.js
 *
 * Provides map-based discovery validation and processing (Phase 30).
 * Handles the extraction, validation, and querying of GeoJSON points
 * from Job documents to power the new visual Map layer.
 *
 * Phase 35 enhancement: buildNearQuery now validates coordinates strictly —
 * returns null for 0,0 (null island), NaN, out-of-range, or undefined values.
 */

// Basic constant for the earth's radius in meters (used for radius filtering later)
const EARTH_RADIUS_METERS = 6378137;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 500;

/**
 * Validates that a coordinate pair is real, in-range, and not the default 0,0.
 * @param {number} lat Latitude
 * @param {number} lng Longitude
 * @returns {boolean}
 */
function isValidGeoCoordinate(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false; // Null Island guard
    return true;
}

/**
 * Validates and normalizes latitude and longitude arrays.
 * @param {Array<Number>} coordinates [longitude, latitude]
 * @returns {Array<Number>|null} normalized coordinates, null if invalid
 */
function normalizeCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
        return null;
    }

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);

    if (!isValidGeoCoordinate(lat, lng)) {
        return null;
    }

    return [lng, lat];
}

/**
 * Generates a MongoDB $near query object for 2dsphere indexing.
 * Returns null if coordinates are invalid (0,0 / NaN / out-of-range).
 *
 * @param {Number} lat Latitude (first arg)
 * @param {Number} lng Longitude (second arg)
 * @param {Number} maxDistanceKm Maximum search radius in Kilometers (1-500)
 * @returns {Object|null} MongoDB query segment or null if invalid
 */
function buildNearQuery(lat, lng, maxDistanceKm = 25) {
    if (!isValidGeoCoordinate(lat, lng)) {
        return null;
    }

    const clampedRadius = Math.max(MIN_RADIUS_KM, Math.min(maxDistanceKm, MAX_RADIUS_KM));

    return {
        geo: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [lng, lat], // GeoJSON: [longitude, latitude]
                },
                $maxDistance: clampedRadius * 1000, // Convert km to meters
            },
        },
    };
}

module.exports = {
    EARTH_RADIUS_METERS,
    MIN_RADIUS_KM,
    MAX_RADIUS_KM,
    isValidGeoCoordinate,
    normalizeCoordinates,
    buildNearQuery,
};
