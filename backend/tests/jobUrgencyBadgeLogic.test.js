'use strict';

/**
 * jobUrgencyBadgeLogic.test.js
 * 
 * Tests the gig urgency visual layer.
 * Verifies that:
 * 1. "New" badge appears for jobs < 48hrs old.
 * 2. "High Match" appears when match >= 85%.
 * 3. "Urgent" appears for isPulse OR expiry < 72hrs.
 * 4. "Actively Hiring" appears for priorityListing OR recent hires.
 */

const { getJobUrgencyBadges } = require('../services/jobUrgencyBadgeService');
const Application = require('../models/Application');

jest.mock('../models/Application');

describe('Job Urgency Badge Visual Layer Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Assigns "New" badge to recent jobs', async () => {
        const recentJob = {
            _id: 'job_new',
            createdAt: new Date(), // Created just now
            expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days
        };

        const badges = await getJobUrgencyBadges(recentJob, 50);

        const labels = badges.map(b => b.label);
        expect(labels).toContain('New');
        expect(labels).not.toContain('Urgent');
        expect(labels).not.toContain('High Match');
        expect(labels).not.toContain('Actively Hiring');
    });

    test('Assigns "Urgent" and "High Match" badges appropriately', async () => {
        const urgentJob = {
            _id: 'job_urg',
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days old (not new)
            isPulse: true, // Pulse = urgent
        };

        const badges = await getJobUrgencyBadges(urgentJob, 92); // 92% match

        const labels = badges.map(b => b.label);
        expect(labels).toContain('Urgent');
        expect(labels).toContain('High Match');
        expect(labels).not.toContain('New');
    });

    test('Assigns "Actively Hiring" for priority listings', async () => {
        const priorityJob = {
            _id: 'job_prio',
            createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
            priorityListing: true
        };

        const badges = await getJobUrgencyBadges(priorityJob);

        const labels = badges.map(b => b.label);
        expect(labels).toContain('Actively Hiring');
    });

    test('Assigns "Actively Hiring" if recent hires occur even without priority', async () => {
        const normalJob = {
            _id: 'job_normal',
            createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
            priorityListing: false
        };

        Application.countDocuments.mockResolvedValueOnce(2); // 2 recent hires

        const badges = await getJobUrgencyBadges(normalJob);

        const labels = badges.map(b => b.label);
        expect(labels).toContain('Actively Hiring');
    });

});
