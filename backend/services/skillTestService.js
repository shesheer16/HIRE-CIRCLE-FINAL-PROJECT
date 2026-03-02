'use strict';
/**
 * skillTestService.js
 * Feature #68 — In-App Skill Test Certificates
 *
 * Manages skill assessments and certificate issuance.
 * Non-disruptive: additive layer.
 */

const AVAILABLE_TESTS = {
    ms_excel: { name: 'Microsoft Excel', durationMinutes: 20, passMark: 70, price: 99 },
    data_entry: { name: 'Data Entry Speed', durationMinutes: 15, passMark: 65, price: 99 },
    english_comm: { name: 'English Communication', durationMinutes: 25, passMark: 60, price: 149 },
    customer_service: { name: 'Customer Service', durationMinutes: 20, passMark: 70, price: 149 },
    logistics: { name: 'Logistics Operations', durationMinutes: 30, passMark: 75, price: 199 },
    digital_marketing: { name: 'Digital Marketing', durationMinutes: 30, passMark: 70, price: 199 },
};

/**
 * Get all available tests.
 */
function getAvailableTests() {
    return Object.entries(AVAILABLE_TESTS).map(([key, val]) => ({ key, ...val }));
}

/**
 * Evaluate a test result and build a certificate record.
 */
function evaluateTestResult(userId, testKey, score) {
    const test = AVAILABLE_TESTS[testKey];
    if (!test) throw Object.assign(new Error(`Unknown test: ${testKey}`), { code: 400 });
    if (!userId) throw Object.assign(new Error('userId required'), { code: 400 });
    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
        throw Object.assign(new Error('Score must be 0–100'), { code: 400 });
    }
    const passed = numScore >= test.passMark;
    return {
        userId: String(userId),
        testKey,
        testName: test.name,
        score: numScore,
        passMark: test.passMark,
        passed,
        grade: numScore >= 90 ? 'A' : numScore >= 75 ? 'B' : numScore >= test.passMark ? 'C' : 'F',
        certificateId: passed ? `CERT-${testKey.toUpperCase()}-${Date.now()}` : null,
        issuedAt: passed ? new Date() : null,
    };
}

/**
 * Verify a certificate ID is valid format.
 */
function verifyCertificateId(certId) {
    return /^CERT-[A-Z_]+-\d+$/.test(String(certId || ''));
}

/**
 * Get grade label for score.
 */
function getGradeLabel(score) {
    if (score >= 90) return 'Distinction';
    if (score >= 75) return 'Merit';
    if (score >= 60) return 'Pass';
    return 'Fail';
}

module.exports = {
    AVAILABLE_TESTS,
    getAvailableTests,
    evaluateTestResult,
    verifyCertificateId,
    getGradeLabel,
};
