'use strict';

/**
 * socialProofDisplayIntegrity.test.js
 * 
 * Verifies that the UI badges correctly map from aggregated DB data.
 */

const { getWorkerSocialProof, getEmployerSocialProof } = require('../services/socialProofDisplayService');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Job = require('../models/Job');

jest.mock('../models/userModel');
jest.mock('../models/WorkerProfile');
jest.mock('../models/Application');
jest.mock('../models/Job');

describe('Social Proof Display Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Aggregates Worker badges based on DB stats', async () => {
        // Fast responder, Hired 5 times, 10 interviews
        WorkerProfile.findOne.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({ _id: 'wrk_1', lastActiveAt: new Date() })
        });

        Application.countDocuments = jest.fn()
            .mockResolvedValueOnce(5) // Hires
            .mockResolvedValueOnce(10); // Interviews

        User.findById.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({ responseScore: 95 })
        });

        const data = await getWorkerSocialProof('user_1');

        // WorkerProofLabels -> Hired 5 times, Interviewed 10 times, Fast responder, Active this week
        expect(data.badges).toHaveLength(4);

        const labels = data.badges.map(b => b.label);
        expect(labels).toContain('Hired 5 times');
        expect(labels).toContain('Interviewed 10 times');
        expect(labels).toContain('Fast responder');
        expect(labels).toContain('Active this week');
    });

    test('Aggregates Employer badges based on DB stats', async () => {
        // Active recruiter, Hired 20, <1h response
        User.findById.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({ responseScore: 92, lastActiveAt: new Date() })
        });

        Application.countDocuments.mockResolvedValueOnce(20); // totalHires
        Job.countDocuments.mockResolvedValueOnce(3); // active open jobs

        const data = await getEmployerSocialProof('emp_1');

        // EmployerProofLabels -> Hired 20 candidates, Avg response <1h, Active recruiter, Active this week
        expect(data.badges).toHaveLength(4);

        const labels = data.badges.map(b => b.label);
        expect(labels).toContain('Hired 20 candidates');
        expect(labels).toContain('Avg response <1h');
        expect(labels).toContain('Active recruiter');
        expect(labels).toContain('Active this week');
    });

});
