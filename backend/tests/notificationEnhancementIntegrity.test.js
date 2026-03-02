'use strict';

/**
 * notificationEnhancementIntegrity.test.js
 * 
 * Verifies that the new Notification Enhancements (Phase 26):
 * 1. Properly map custom types to allowed Enums in the Notification schema.
 * 2. Save correctly to the DB.
 * 3. Enforce 24-hour deduplication based on dedupeKey to prevent spam.
 */

const { triggerEnhancedNotification } = require('../services/notificationEnhancementService');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

// We use an in-memory db setup or mock. We will mock Mongoose model.
jest.mock('../models/Notification');

describe('Notification Enhancement Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Maps "employer_viewed_profile" securely without enum violation', async () => {
        Notification.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null) // no duplicate
        });

        // Mock save
        const mockSave = jest.fn().mockResolvedValue(true);
        Notification.mockImplementation(function (data) {
            Object.assign(this, data);
            this.save = mockSave;
        });

        const result = await triggerEnhancedNotification('user_123', 'employer_viewed_profile', {
            companyName: 'Tech Corp',
            dedupeKey: 'emp_view_user_123_tech_corp'
        });

        expect(Notification.findOne).toHaveBeenCalledWith(expect.objectContaining({
            'relatedData.dedupeKey': 'emp_view_user_123_tech_corp'
        }));

        expect(result.type).toBe('employer_viewed_profile'); // valid enum
        expect(result.title).toContain('Employer Viewed');
        expect(mockSave).toHaveBeenCalled();
    });

    test('Prevents duplicate notifications within 24 hours using dedupeKey', async () => {
        // Return an existing notification to simulate recent duplicate
        Notification.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue({ _id: 'notif_existing' })
        });

        const mockSave = jest.fn();
        Notification.mockImplementation(function () {
            this.save = mockSave;
        });

        const result = await triggerEnhancedNotification('user_123', 'escrow_funded_alert', {
            companyName: 'Hotel ABC',
            amount: 500,
            currency: 'USD',
            dedupeKey: 'escrow_fund_job_123'
        });

        expect(result).toBeUndefined(); // Returns early, didn't create
        expect(mockSave).not.toHaveBeenCalled();
    });

    test('Maps "escrow_funded_alert" to valid schema enum', async () => {
        Notification.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null)
        });

        const mockSave = jest.fn();
        Notification.mockImplementation(function (data) {
            Object.assign(this, data);
            this.save = mockSave;
        });

        const result = await triggerEnhancedNotification('user_1', 'escrow_funded_alert', {
            companyName: 'Cafe', amount: 100, currency: 'GBP', dedupeKey: 'k2'
        });

        expect(result.type).toBe('escrow_update'); // correctly mapped to schema
        expect(result.message).toContain('100 GBP');
        expect(result.message).toContain('Escrow');
        expect(mockSave).toHaveBeenCalled();
    });
});
