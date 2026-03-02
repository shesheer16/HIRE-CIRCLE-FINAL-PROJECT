const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        const requestedRole = String(req.headers['x-role'] || 'worker').toLowerCase();
        const isEmployer = requestedRole === 'employer';
        req.user = {
            _id: '507f191e810c19729de860aa',
            role: isEmployer ? 'recruiter' : 'candidate',
            activeRole: isEmployer ? 'employer' : 'worker',
            primaryRole: isEmployer ? 'employer' : 'worker',
        };
        next();
    },
}));

jest.mock('../middleware/validate', () => ({
    validate: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/rateLimiters', () => ({
    loginAttemptLimiter: (_req, _res, next) => next(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));

jest.mock('../models/userModel', () => ({}));

jest.mock('../models/InterviewProcessingJob', () => ({
    findOne: jest.fn(),
}));

jest.mock('../services/interviewProcessingService', () => ({
    markProfileConfirmed: jest.fn().mockResolvedValue({ ok: true }),
    finalizeInterviewSignalIfEligible: jest.fn().mockResolvedValue({ finalized: true }),
}));

jest.mock('../services/metricsService', () => ({
    publishMetric: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/revenueInstrumentationService', () => ({
    fireAndForget: jest.fn(),
    recordLifecycleEvent: jest.fn().mockResolvedValue({ ok: true }),
    normalizeSalaryBand: jest.fn().mockReturnValue('normal'),
}));

jest.mock('../services/smartInterviewDatasetService', () => ({
    captureSmartInterviewDatasetSnapshot: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/smartInterviewAnalyticsSnapshotService', () => ({
    captureSmartInterviewAnalyticsSnapshot: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/referralService', () => ({
    evaluateReferralEligibility: jest.fn().mockResolvedValue({ eligible: false }),
    getReferralDashboard: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/growthFunnelService', () => ({
    trackFunnelStage: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/monetizationIntelligenceService', () => ({
    recordFeatureUsage: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../services/cacheService', () => ({
    delByPattern: jest.fn().mockResolvedValue(0),
}));

jest.mock('../services/asyncTaskDispatcher', () => ({
    dispatchAsyncTask: jest.fn().mockResolvedValue({ queued: true }),
    TASK_TYPES: {
        TRUST_SCORE_RECALCULATION: 'TRUST_SCORE_RECALCULATION',
    },
}));

jest.mock('../services/reputationEngineService', () => ({
    getProfileAuthoritySnapshot: jest.fn().mockResolvedValue(null),
    recalculateReputationProfile: jest.fn().mockResolvedValue({}),
}));

jest.mock('../controllers/userController', () => ({
    registerUser: (_req, res) => res.status(200).json({ ok: true }),
    authUser: (_req, res) => res.status(200).json({ ok: true }),
    refreshAuthToken: (_req, res) => res.status(200).json({ ok: true }),
    logoutUser: (_req, res) => res.status(200).json({ ok: true }),
    forgotPassword: (_req, res) => res.status(200).json({ ok: true }),
    resetPassword: (_req, res) => res.status(200).json({ ok: true }),
    verifyEmail: (_req, res) => res.status(200).json({ ok: true }),
    resendVerificationEmail: (_req, res) => res.status(200).json({ ok: true }),
    exportUserData: (_req, res) => res.status(200).json({ ok: true }),
    getWorkerLockInSummaryController: (_req, res) => res.status(200).json({ ok: true }),
}));

jest.mock('../controllers/settingsController', () => ({
    deleteAccount: (_req, res) => res.status(200).json({ ok: true }),
}));

const WorkerProfile = require('../models/WorkerProfile');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const { finalizeInterviewSignalIfEligible } = require('../services/interviewProcessingService');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/users', require('../routes/userRoutes'));
    return app;
};

describe('profile data integrity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects protected field overwrite attempts', async () => {
        const app = buildApp();
        const response = await request(app)
            .put('/api/users/profile')
            .send({
                firstName: 'Alice',
                city: 'Hyderabad',
                trustScore: 100,
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/protected profile fields/i);
        expect(WorkerProfile.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('persists interview-verified worker profile update from completed processing job', async () => {
        const processingId = '507f191e810c19729de860ea';
        WorkerProfile.findOne.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: 'worker-profile-1',
                    firstName: 'Alice',
                    city: 'Hyderabad',
                }),
            }),
        });
        WorkerProfile.findOneAndUpdate.mockResolvedValue({
            _id: 'worker-profile-1',
            firstName: 'Alice',
            city: 'Hyderabad',
            interviewVerified: true,
            roleProfiles: [{ roleName: 'Cook', expectedSalary: 32000 }],
        });
        InterviewProcessingJob.findOne.mockReturnValue({
            select: async () => ({
                _id: processingId,
                rawMetrics: {
                    profileQualityScore: 0.92,
                    communicationClarityScore: 0.81,
                    salaryOutlierFlag: false,
                },
            }),
        });

        const app = buildApp();
        const response = await request(app)
            .put('/api/users/profile')
            .send({
                firstName: 'Alice',
                city: 'Hyderabad',
                totalExperience: 4,
                roleProfiles: [{
                    roleName: 'Cook',
                    experienceInRole: 4,
                    expectedSalary: 32000,
                    skills: ['North Indian', 'Inventory'],
                }],
                processingId,
            });

        expect(response.status).toBe(200);
        expect(finalizeInterviewSignalIfEligible).toHaveBeenCalledWith({
            processingId,
            userId: '507f191e810c19729de860aa',
        });
        expect(WorkerProfile.findOneAndUpdate).toHaveBeenCalledWith(
            { user: '507f191e810c19729de860aa' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    firstName: 'Alice',
                    city: 'Hyderabad',
                    interviewVerified: true,
                    interviewIntelligence: expect.objectContaining({
                        profileQualityScore: 0.92,
                        communicationClarityScore: 0.81,
                    }),
                }),
            }),
            expect.objectContaining({
                new: true,
                upsert: true,
                runValidators: true,
            })
        );
    });
});
