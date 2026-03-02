'use strict';

/**
 * supportDeflectionIntegrity.test.js
 * 
 * Verifies that the new Support Center Layer (Phase 27):
 * 1. Properly deflects based on NLP keywords.
 * 2. Can create valid support tickets when deflection is bypassed.
 * 3. Throws on missing required payload fields.
 */

const { deflectWithFAQ, createSupportTicket, getUserTickets } = require('../services/supportCenterService');
const SupportTicket = require('../models/SupportTicket');

jest.mock('../models/SupportTicket');

describe('Support Center Deflection Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Deflects payment questions to Escrow FAQ', () => {
        const inquiry = "When will you release my money from escrow?";

        const faqs = deflectWithFAQ(inquiry);

        expect(faqs).toHaveLength(1);
        expect(faqs[0].topic).toBe('payment');
        expect(faqs[0].answer).toContain('Escrow');
    });

    test('Deflects identity questions to Verification FAQ', () => {
        const inquiry = "How do I verify my id to get matches?";

        const faqs = deflectWithFAQ(inquiry);

        expect(faqs).toHaveLength(1);
        expect(faqs[0].topic).toBe('account');
        expect(faqs[0].answer).toContain('Government ID');
    });

    test('Returns empty array when no keywords match', () => {
        const inquiry = "Can I change my username?";

        const faqs = deflectWithFAQ(inquiry);

        expect(faqs).toHaveLength(0);
    });

    test('Successfully creates a support ticket', async () => {
        const mockSave = jest.fn().mockResolvedValue(true);
        SupportTicket.mockImplementation(function (data) {
            Object.assign(this, data);
            this.status = this.status || 'open'; // Simulate mongoose default
            this.save = mockSave;
        });

        const ticket = await createSupportTicket('user_123', {
            topic: 'bug_report',
            subject: 'App crashing on chat screen',
            description: 'When I click send, the app closes.',
            metadata: { jobId: 'job_456' }
        });

        expect(ticket.user).toBe('user_123');
        expect(ticket.topic).toBe('bug_report');
        expect(ticket.status).toBe('open');
        expect(mockSave).toHaveBeenCalled();
    });

    test('Throws on incomplete ticket payload', async () => {
        await expect(createSupportTicket('user_123', {
            topic: 'account',
            subject: 'Help'
            // missing description
        })).rejects.toThrow('Incomplete ticket payload');
    });

    test('Retrieves user ticket history sorted by creation date', async () => {
        SupportTicket.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                { subject: 'Ticket 2', createdAt: new Date() },
                { subject: 'Ticket 1', createdAt: new Date(Date.now() - 1000) }
            ])
        });

        const tickets = await getUserTickets('user_123');
        expect(tickets).toHaveLength(2);
        expect(tickets[0].subject).toBe('Ticket 2');
    });

});
