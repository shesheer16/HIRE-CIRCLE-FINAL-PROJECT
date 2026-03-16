'use strict';
/**
 * apRegionalDataV10.js
 *
 * AP-first launch dataset used by the regional matching overlay.
 * This is intentionally a curated subset (district HQ + Madanapalle mandal villages).
 *
 * If a location is not present here, the engine falls back to generic matching.
 */

const ZONE = Object.freeze({
    URBAN: 'urban',
    SEMIURBAN: 'semiurban',
    RURAL: 'rural',
    AGRICULTURAL: 'agricultural',
    COASTAL: 'coastal',
    INDUSTRIAL: 'industrial',
    CAMPUS: 'campus',
});

// 26 Districts (AP 2026 list) + Madanapalle mandal villages (subset)
const AP_LOCATIONS = Object.freeze([
    { n: 'Srikakulam', lat: 18.2967, lng: 83.8978, zone: ZONE.URBAN, mandal: 'Srikakulam', district: 'Srikakulam' },
    { n: 'Parvathipuram Manyam', lat: 18.78, lng: 83.42, zone: ZONE.SEMIURBAN, mandal: 'Parvathipuram', district: 'Parvathipuram Manyam' },
    { n: 'Vizianagaram', lat: 18.1183, lng: 83.3951, zone: ZONE.URBAN, mandal: 'Vizianagaram', district: 'Vizianagaram' },
    { n: 'Visakhapatnam', lat: 17.6868, lng: 83.2185, zone: ZONE.URBAN, mandal: 'Visakhapatnam', district: 'Visakhapatnam' },
    { n: 'Anakapalli', lat: 17.68, lng: 83.0, zone: ZONE.URBAN, mandal: 'Anakapalli', district: 'Anakapalli' },
    { n: 'Alluri Sitharama Raju', lat: 17.68, lng: 82.95, zone: ZONE.RURAL, mandal: 'Paderu', district: 'Alluri Sitharama Raju' },
    { n: 'Kakinada', lat: 16.9891, lng: 82.2475, zone: ZONE.URBAN, mandal: 'Kakinada', district: 'Kakinada' },
    { n: 'East Godavari', lat: 16.92, lng: 82.22, zone: ZONE.URBAN, mandal: 'Rajahmundry', district: 'East Godavari' },
    { n: 'Dr. B.R. Ambedkar Konaseema', lat: 16.75, lng: 82.05, zone: ZONE.COASTAL, mandal: 'Amalapuram', district: 'Konaseema' },
    { n: 'West Godavari', lat: 16.71, lng: 81.09, zone: ZONE.URBAN, mandal: 'Eluru', district: 'West Godavari' },
    { n: 'Eluru', lat: 16.71, lng: 81.09, zone: ZONE.URBAN, mandal: 'Eluru', district: 'Eluru' },
    { n: 'Krishna', lat: 16.5, lng: 80.65, zone: ZONE.URBAN, mandal: 'Machilipatnam', district: 'Krishna' },
    { n: 'NTR', lat: 16.5, lng: 80.65, zone: ZONE.URBAN, mandal: 'Vijayawada', district: 'NTR' },
    { n: 'Guntur', lat: 16.3067, lng: 80.4365, zone: ZONE.URBAN, mandal: 'Guntur', district: 'Guntur' },
    { n: 'Palnadu', lat: 16.25, lng: 80.05, zone: ZONE.SEMIURBAN, mandal: 'Narasaraopet', district: 'Palnadu' },
    { n: 'Bapatla', lat: 15.9, lng: 80.46, zone: ZONE.COASTAL, mandal: 'Bapatla', district: 'Bapatla' },
    { n: 'Prakasam', lat: 15.5, lng: 80.05, zone: ZONE.RURAL, mandal: 'Ongole', district: 'Prakasam' },
    { n: 'Nellore', lat: 14.4426, lng: 79.9865, zone: ZONE.URBAN, mandal: 'Nellore', district: 'Nellore' },
    { n: 'Tirupati', lat: 13.6288, lng: 79.4192, zone: ZONE.URBAN, mandal: 'Tirupati', district: 'Tirupati' },
    { n: 'Annamayya', lat: 13.55, lng: 78.5, zone: ZONE.SEMIURBAN, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Chittoor', lat: 13.216, lng: 79.099, zone: ZONE.URBAN, mandal: 'Chittoor', district: 'Chittoor' },
    { n: 'Ananthapuramu', lat: 14.6834, lng: 77.5997, zone: ZONE.URBAN, mandal: 'Ananthapuramu', district: 'Ananthapuramu' },
    { n: 'Sri Sathya Sai', lat: 14.16, lng: 77.81, zone: ZONE.RURAL, mandal: 'Puttaparthi', district: 'Sri Sathya Sai' },
    { n: 'Kurnool', lat: 15.8281, lng: 78.0373, zone: ZONE.URBAN, mandal: 'Kurnool', district: 'Kurnool' },
    { n: 'Nandyal', lat: 15.478, lng: 78.483, zone: ZONE.URBAN, mandal: 'Nandyal', district: 'Nandyal' },
    { n: 'Y.S.R. Kadapa', lat: 14.4674, lng: 78.8241, zone: ZONE.URBAN, mandal: 'Kadapa', district: 'Y.S.R. Kadapa' },

    // Madanapalle mandal villages (subset)
    { n: 'Chinnathippasamudram', lat: 13.52, lng: 78.48, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Kollabylu', lat: 13.56, lng: 78.52, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Kothavaripalle', lat: 13.54, lng: 78.49, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Basinikonda', lat: 13.53, lng: 78.51, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Malepadu', lat: 13.55, lng: 78.47, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Pothapalu', lat: 13.57, lng: 78.5, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
    { n: 'Valasapalle', lat: 13.54, lng: 78.53, zone: ZONE.RURAL, mandal: 'Madanapalle', district: 'Annamayya' },
]);

// Stubs for future AP-specific enrichment.
const AP_JOB_CATEGORIES = Object.freeze({});
const AP_ADJACENCY_GRAPH = new Map();

const AP_HAVERSINE = Object.freeze({
    METRO_KM: 30,
    MANDAL_KM: 10,
    DISTRICT_KM: 80,
    REGIONAL_KM: 200,
});

const AP_ZONE_META = Object.freeze({
    rural: Object.freeze({
        sparseThreshold: 2,
        ruralBoost: 0.18,
        languageFlex: 0.15,
        genderMobilityPenalty: 0.92,
        smartphoneGigBoost: 1.18,
        villageProximity: 0.18,
    }),
});

// Additional config referenced by the AP engine (safe defaults).
const VBG_RAM_G_CONFIG = Object.freeze({
    pauseMonths: [5, 6, 10, 11],
});

const DIALECT_AFFINITY = Object.freeze({});

module.exports = {
    ZONE,
    AP_LOCATIONS,
    AP_JOB_CATEGORIES,
    AP_ADJACENCY_GRAPH,
    AP_HAVERSINE,
    AP_ZONE_META,
    VBG_RAM_G_CONFIG,
    DIALECT_AFFINITY,
};

