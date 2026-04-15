'use strict';
/**
 * travelTimeService.js
 * Feature #3 — Travel Time Estimate in Job Cards (ETA)
 *
 * Computes estimated travel time from a worker's location to a job's location.
 * Uses haversine distance (already in geoDiscoveryService) + average speed model.
 * Does NOT call an external Maps API (to avoid key dependency).
 * When Google Maps Distance Matrix key is available, swap to live API.
 *
 * Non-disruptive: additive layer. No match engine changes.
 */

// geoDiscoveryService may or may not export haversineDistanceKm — prefer self-contained
let _geoHaversine;
try { _geoHaversine = require('./geoDiscoveryService').haversineDistanceKm; } catch (_) { /* ignore */ }


// Self-contained haversine fallback — removes dependency on geoDiscoveryService export
function _haversineDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Use geo module's haversine if available, otherwise use self-contained fallback
function haversineKm(lat1, lng1, lat2, lng2) {
    if (typeof _geoHaversine === 'function') {
        try { return _geoHaversine(lat1, lng1, lat2, lng2); } catch (_) { /* fall through */ }
    }
    return _haversineDistanceKm(lat1, lng1, lat2, lng2);
}


// Average speeds (km/h) by transport mode
const SPEED_KMH = {
    walking: 5,
    cycling: 15,
    auto: 30,   // auto-rickshaw / 2-wheeler
    driving: 45,
    transit: 25,
};

const MODES = Object.keys(SPEED_KMH);

/**
 * Estimate travel time between two coordinate pairs.
 *
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @param {'walking'|'cycling'|'auto'|'driving'|'transit'} mode
 * @returns {{ distanceKm: number, etaMinutes: number, etaText: string, mode: string } | null}
 */
function estimateTravelTime(from, to, mode = 'auto') {
    if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return null;
    if (!MODES.includes(mode)) mode = 'auto';

    const distanceKm = haversineKm(
        from.lat, from.lng,
        to.lat, to.lng,
    );

    if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;

    const speedKmh = SPEED_KMH[mode];
    const etaMinutes = Math.ceil((distanceKm / speedKmh) * 60);

    const etaText = etaMinutes < 60
        ? `${etaMinutes} min`
        : `${Math.floor(etaMinutes / 60)}h ${etaMinutes % 60}m`;

    return {
        distanceKm: Math.round(distanceKm * 10) / 10,
        etaMinutes,
        etaText,
        mode,
    };
}

/**
 * Get ETA for all transport modes.
 */
function estimateAllModes(from, to) {
    return MODES.reduce((acc, mode) => {
        acc[mode] = estimateTravelTime(from, to, mode);
        return acc;
    }, {});
}

module.exports = { estimateTravelTime, estimateAllModes, SPEED_KMH, MODES };
