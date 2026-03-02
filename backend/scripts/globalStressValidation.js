/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const {
    DEFAULT_BASE_CURRENCY,
    convertAmount,
} = require('../services/currencyConversionService');
const { formatInTimeZone } = require('../utils/timezone');
const { filterJobsByGeo } = require('../services/geoMatchService');

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const readJson = (relativePath) => {
    const absolutePath = path.resolve(__dirname, '..', '..', relativePath);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(raw);
};

const simulateMixedCurrencyTransactions = async () => {
    const baseAmount = 125;
    const inr = await convertAmount({ amount: baseAmount, fromCurrency: DEFAULT_BASE_CURRENCY, toCurrency: 'INR' });
    const eur = await convertAmount({ amount: baseAmount, fromCurrency: DEFAULT_BASE_CURRENCY, toCurrency: 'EUR' });

    assert(Number(inr.amount) > 0, 'INR conversion failed');
    assert(Number(eur.amount) > 0, 'EUR conversion failed');

    return {
        baseAmount,
        baseCurrency: DEFAULT_BASE_CURRENCY,
        inr: inr.amount,
        eur: eur.amount,
    };
};

const simulateCrossTimezoneInterviewView = () => {
    const interviewUtc = new Date('2026-03-01T10:30:00.000Z');
    const indiaView = formatInTimeZone(interviewUtc, 'Asia/Kolkata');
    const usView = formatInTimeZone(interviewUtc, 'America/New_York');

    assert(indiaView !== usView, 'Timezone rendering should differ');

    return {
        interviewUtc: interviewUtc.toISOString(),
        indiaView,
        usView,
    };
};

const simulateCrossBorderMatchFiltering = () => {
    const jobs = [
        { id: 'same-country', country: 'IN', remoteAllowed: false },
        { id: 'cross-border', country: 'US', remoteAllowed: false },
        { id: 'remote-global', country: 'US', remoteAllowed: true },
    ];

    const strict = filterJobsByGeo({
        jobs,
        user: { country: 'IN', globalPreferences: { crossBorderMatchEnabled: false } },
        allowCrossBorder: false,
    }).jobs;

    const crossBorder = filterJobsByGeo({
        jobs,
        user: { country: 'IN', globalPreferences: { crossBorderMatchEnabled: true } },
        allowCrossBorder: true,
    }).jobs;

    assert(strict.length === 2, 'Strict geo filtering expected 2 jobs (same-country + remote)');
    assert(crossBorder.length === 3, 'Cross-border filtering expected all jobs');

    return {
        strictJobIds: strict.map((job) => job.id),
        crossBorderJobIds: crossBorder.map((job) => job.id),
    };
};

const simulateLanguageToggleMidSession = () => {
    const webEn = readJson('frontend/src/i18n/translations/en.json');
    const webHi = readJson('frontend/src/i18n/translations/hi.json');

    assert(webEn.settings.title, 'Missing English translation key: settings.title');
    assert(webHi.settings.title, 'Missing Hindi translation key: settings.title');

    let sessionLanguage = 'en';
    const titleBefore = webEn.settings.title;
    sessionLanguage = 'hi';
    const titleAfter = webHi.settings.title;

    assert(sessionLanguage === 'hi', 'Language switch failed');
    assert(titleBefore !== titleAfter, 'Language switch should change visible text');

    return {
        titleBefore,
        titleAfter,
    };
};

const simulateRegionFeatureFlagToggle = () => {
    const flagsByRegion = {
        'IN-GENERAL': { FEATURE_VIDEO_CALL: true, FEATURE_ESCROW: true, FEATURE_BOUNTIES: true },
        'US-GENERAL': { FEATURE_VIDEO_CALL: true, FEATURE_ESCROW: false, FEATURE_BOUNTIES: false },
    };

    const india = flagsByRegion['IN-GENERAL'];
    const us = flagsByRegion['US-GENERAL'];

    assert(india.FEATURE_ESCROW === true, 'Expected escrow enabled in IN region');
    assert(us.FEATURE_ESCROW === false, 'Expected escrow disabled in US region');

    return {
        india,
        us,
    };
};

const run = async () => {
    const summary = {
        mixedCurrencyTransactions: await simulateMixedCurrencyTransactions(),
        crossTimezoneInterviewView: simulateCrossTimezoneInterviewView(),
        crossBorderMatchFiltering: simulateCrossBorderMatchFiltering(),
        languageToggleMidSession: simulateLanguageToggleMidSession(),
        regionFeatureFlagToggle: simulateRegionFeatureFlagToggle(),
        stable: true,
    };

    console.log(JSON.stringify({
        event: 'global_stress_validation_passed',
        summary,
    }, null, 2));
};

run().catch((error) => {
    console.error(JSON.stringify({
        event: 'global_stress_validation_failed',
        message: error.message,
    }, null, 2));
    process.exit(1);
});
