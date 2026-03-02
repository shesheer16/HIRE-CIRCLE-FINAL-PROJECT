'use strict';

/**
 * calendarVisualizationIntegrity.test.js
 * 
 * Tests the Shift Calendar / Work Calendar visualization layer.
 * Verifies that:
 * 1. The timeline pulls exactly from the existing state machine data (no new state).
 * 2. It compiles upcoming interviews correctly.
 * 3. It compiles job accepted / hired states correctly.
 * 4. It pulls accurate work_started dates from Transition Logs.
 * 5. It calculates Payment release / pending correctly from Escrow.
 * 6. The output is chronologically sorted.
 */

const { buildTimelineFromApplications } = require('../services/calendarVisualizationService');
const InterviewSchedule = require('../models/InterviewSchedule');
const Escrow = require('../models/Escrow');
const ApplicationTransitionLog = require('../models/ApplicationTransitionLog');

// Mock mongoose models
jest.mock('../models/InterviewSchedule');
jest.mock('../models/Escrow');
jest.mock('../models/ApplicationTransitionLog');

describe('Shift Calendar / Work Calendar Visualization Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Aggregates and sorts read-only timeline correctly for Worker', async () => {
        const mockApplications = [
            {
                _id: 'app_1',
                job: { _id: 'job_1', title: 'Barista', companyName: 'Cafe 101' },
                worker: { _id: 'wrk_1', user: { name: 'Alice' } },
                offerAcceptedAt: new Date('2026-03-01T10:00:00Z')
            },
            {
                _id: 'app_2',
                job: { _id: 'job_2', title: 'Driver', companyName: 'Logistics Pro' },
                worker: { _id: 'wrk_1', user: { name: 'Alice' } },
                hiredAt: new Date('2026-02-28T09:00:00Z')
            }
        ];

        // Mock Interviews
        InterviewSchedule.find.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([
                    {
                        applicationId: 'app_1',
                        jobId: { title: 'Barista', companyName: 'Cafe 101' },
                        scheduledTimeUTC: new Date('2026-02-20T14:00:00Z'),
                        status: 'completed'
                    }
                ])
            })
        });

        // Mock Escrows (Payment)
        Escrow.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([
                {
                    jobId: 'job_1',
                    workerId: 'wrk_1',
                    amount: 500,
                    currency: 'INR',
                    status: 'funded',
                    createdAt: new Date('2026-03-01T11:00:00Z')
                },
                {
                    jobId: 'job_2',
                    workerId: 'wrk_1',
                    amount: 1200,
                    currency: 'INR',
                    status: 'released',
                    releasedAt: new Date('2026-03-02T15:00:00Z')
                }
            ])
        });

        // Mock Transition Logs (Work Started)
        ApplicationTransitionLog.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([
                {
                    applicationId: 'app_2',
                    nextStatus: 'work_started',
                    createdAt: new Date('2026-03-01T08:00:00Z')
                }
            ])
        });

        const timeline = await buildTimelineFromApplications(mockApplications, 'worker');

        // Expected output:
        // 1. Feb 20: Interview for Barista (completed)
        // 2. Feb 28: Job Accepted: Driver (app_2, hiredAt)
        // 3. Mar 01, 08:00: Work Started: Driver (app_2, log)
        // 4. Mar 01, 10:00: Job Accepted: Barista (app_1, offerAcceptedAt)
        // 5. Mar 01, 11:00: Escrow Funded: Barista (app_1, pending)
        // 6. Mar 02, 15:00: Payment Released: Driver (app_2, released)

        expect(timeline.length).toBe(6);
        expect(timeline[0].type).toBe('interview');
        expect(timeline[0].title).toContain('Barista');

        expect(timeline[1].type).toBe('job_accepted');
        expect(timeline[1].title).toContain('Driver');

        expect(timeline[2].type).toBe('work_started');
        expect(timeline[2].title).toContain('Driver');

        expect(timeline[3].type).toBe('job_accepted');
        expect(timeline[3].title).toContain('Barista');

        expect(timeline[4].type).toBe('payment_pending');
        expect(timeline[4].title).toContain('Escrow Funded');

        expect(timeline[5].type).toBe('payment_released');
        expect(timeline[5].title).toContain('Payment Released');
        expect(timeline[5].subtitle).toContain('1200 INR');
    });

    test('Aggregates data for Employer (Shift Timeline layout)', async () => {
        const mockApplications = [
            {
                _id: 'app_3',
                job: { _id: 'job_3', title: 'Chef', companyName: 'Hotel XYZ' },
                worker: { _id: 'wrk_3', user: { name: 'Bob' } },
                offerAcceptedAt: new Date('2026-03-03T10:00:00Z')
            }
        ];

        InterviewSchedule.find.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([])
            })
        });

        Escrow.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
        });

        ApplicationTransitionLog.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([
                {
                    applicationId: 'app_3',
                    nextStatus: 'work_started',
                    createdAt: new Date('2026-03-04T08:00:00Z')
                }
            ])
        });

        const timeline = await buildTimelineFromApplications(mockApplications, 'employer');

        expect(timeline.length).toBe(2);
        expect(timeline[0].type).toBe('job_accepted');
        expect(timeline[0].subtitle).toBe('Candidate accepted offer');

        expect(timeline[1].type).toBe('work_started');
        expect(timeline[1].subtitle).toBe('Candidate began work');
    });
});
