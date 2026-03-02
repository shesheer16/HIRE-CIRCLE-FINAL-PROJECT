'use strict';

/**
 * verificationStatusLayer.test.js
 * 
 * Tests the Verification Status visualization.
 * It verifies that existing flags (phone, email, ID, employer) are accurately mapped 
 * to visual statuses, colors, and educational tooltips.
 */

const { getVerificationPanelData } = require('../services/verificationStatusService');
const User = require('../models/userModel');

jest.mock('../models/userModel');

describe('Verification Status Panel Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Maps healthy 100% worker profile accurately', async () => {
        User.findById = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({
                _id: 'user_1',
                roles: ['worker'],
                phoneNumber: '+1234567890',
                isEmailVerified: true,
                verificationSignals: { govtIdVerified: true }
            })
        });

        const data = await getVerificationPanelData('user_1');

        expect(data.verifications).toHaveLength(3); // Phone, Email, Identity
        expect(data.summary.completed).toBe(3);
        expect(data.summary.total).toBe(3);
        expect(data.summary.overallTrustLevel).toBe('Maximum Trust');

        const phone = data.verifications.find(v => v.id === 'phone_verification');
        expect(phone.isVerified).toBe(true);
        expect(phone.color).toBe('green');
        expect(phone.tooltip).toContain('Employers can contact you instantly');
    });

    test('Maps empty profile with gray indicators and conversion tooltips', async () => {
        User.findById = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({
                _id: 'user_2',
                roles: ['worker'],
                phoneNumber: null,
                isEmailVerified: false,
                verificationSignals: {}
            })
        });

        const data = await getVerificationPanelData('user_2');

        expect(data.summary.completed).toBe(0);
        expect(data.summary.overallTrustLevel).toBe('Standard');

        const identity = data.verifications.find(v => v.id === 'identity_verification');
        expect(identity.isVerified).toBe(false);
        expect(identity.color).toBe('gray');
        expect(identity.tooltip).toContain('unlock premium employer matches');
    });

    test('Includes Employer flag if roles includes employer', async () => {
        User.findById = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({
                _id: 'user_3',
                roles: ['worker', 'employer'],
                phoneNumber: '+123',
                isEmailVerified: false,
                verificationSignals: { companyRegistrationVerified: true }
            })
        });

        const data = await getVerificationPanelData('user_3');

        expect(data.verifications).toHaveLength(4); // Phone, Email, Identity, Company
        const company = data.verifications.find(v => v.id === 'employer_verification');
        expect(company.isVerified).toBe(true);
        expect(company.color).toBe('purple');
    });

    test('Throws if user not found', async () => {
        User.findById = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(null)
        });

        await expect(getVerificationPanelData('missing')).rejects.toThrow('User not found');
    });
});
