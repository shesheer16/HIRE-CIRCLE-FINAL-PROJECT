jest.mock('../models/Application', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/ApplicationTransitionLog', () => ({
    create: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    findById: jest.fn(),
}));

jest.mock('../services/revenueInstrumentationService', () => ({
    normalizeSalaryBand: jest.fn(() => 'unknown'),
    recordLifecycleEvent: jest.fn(),
}));

const ApplicationTransitionLog = require('../models/ApplicationTransitionLog');
const Job = require('../models/Job');
const { transitionApplicationStatus } = require('../services/applicationWorkflowService');

const buildApplication = (overrides = {}) => ({
    _id: 'app-1',
    employer: 'emp-1',
    worker: 'worker-1',
    job: 'job-1',
    status: 'applied',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    workflowMeta: {},
    sla: {},
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
});

describe('applicationWorkflowService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Job.findById.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    location: 'Hyderabad',
                    title: 'Cook',
                    salaryRange: '15000-20000',
                    shift: 'Day',
                }),
            }),
        });
        ApplicationTransitionLog.create.mockResolvedValue({ _id: 'transition-1' });
    });

    it('transitions a valid status and writes a transition log', async () => {
        const application = buildApplication();

        const result = await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'shortlisted',
            actorType: 'employer',
            actorId: 'emp-1',
            reason: 'manual_status_update',
        });

        expect(result.changed).toBe(true);
        expect(result.toStatus).toBe('shortlisted');
        expect(application.status).toBe('shortlisted');
        expect(application.save).toHaveBeenCalled();
        expect(ApplicationTransitionLog.create).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-1',
            previousStatus: 'applied',
            nextStatus: 'shortlisted',
        }));
        expect(application.workflowMeta).toEqual(expect.objectContaining({
            lastTransitionActor: 'employer',
            lastTransitionReason: 'manual_status_update',
            remindersSent: expect.objectContaining({
                employerNoResponse: 0,
                candidateNoResponse: 0,
                offerExpiry: 0,
            }),
        }));
    });

    it('throws on invalid transition', async () => {
        const application = buildApplication({ status: 'applied' });

        await expect(transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'hired',
            actorType: 'employer',
        })).rejects.toMatchObject({
            code: 'INVALID_STATUS_TRANSITION',
        });
    });

    it('preserves existing reminder counters while updating workflow metadata', async () => {
        const application = buildApplication({
            workflowMeta: {
                remindersSent: {
                    employerNoResponse: 3,
                    candidateNoResponse: 1,
                    offerExpiry: 0,
                },
                lastTransitionActor: 'system',
                lastTransitionReason: 'init',
            },
        });

        await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'shortlisted',
            actorType: 'employer',
            actorId: 'emp-1',
            reason: 'manual_status_update',
        });

        expect(application.workflowMeta.remindersSent).toEqual({
            employerNoResponse: 3,
            candidateNoResponse: 1,
            offerExpiry: 0,
        });
    });
});
