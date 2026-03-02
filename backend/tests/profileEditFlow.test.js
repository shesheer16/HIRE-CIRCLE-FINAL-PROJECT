const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        const requestedRole = String(req.headers['x-role'] || 'worker').toLowerCase();
        const isEmployer = requestedRole === 'employer';
        req.user = {
            _id: '507f191e810c19729de860ab',
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

jest.mock('../models/userModel', () => ({
    findByIdAndUpdate: jest.fn(),
}));

jest.mock('../models/InterviewProcessingJob', () => ({
    findOne: jest.fn(),
}));

jest.mock('../services/interviewProcessingService', () => ({
    markProfileConfirmed: jest.fn().mockResolvedValue({ ok: true }),
    finalizeInterviewSignalIfEligible: jest.fn().mockResolvedValue({ finalized: false }),
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

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/users', require('../routes/userRoutes'));
    return app;
};

describe('profile edit flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        WorkerProfile.findOne.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: 'worker-profile-2',
                    firstName: 'Bob',
                    city: 'Pune',
                }),
            }),
        });
        WorkerProfile.findOneAndUpdate.mockResolvedValue({
            _id: 'worker-profile-2',
            firstName: '&lt;script&gt;Bob&lt;/script&gt;',
            city: 'Pune',
            roleProfiles: [{
                roleName: '&lt;b&gt;Driver&lt;/b&gt;',
                skills: ['&lt;img src=x onerror=alert(1)&gt;'],
            }],
        });
    });

    it('sanitizes text fields and persists skills safely', async () => {
        const app = buildApp();
        const response = await request(app)
            .put('/api/users/profile')
            .send({
                firstName: '<script>Bob</script>',
                city: 'Pune',
                roleProfiles: [{
                    roleName: '<b>Driver</b>',
                    experienceInRole: 2,
                    skills: ['<img src=x onerror=alert(1)>'],
                }],
            });

        expect(response.status).toBe(200);
        expect(WorkerProfile.findOneAndUpdate).toHaveBeenCalledWith(
            { user: '507f191e810c19729de860ab' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    firstName: '&lt;script&gt;Bob&lt;/script&gt;',
                    roleProfiles: [
                        expect.objectContaining({
                            roleName: '&lt;b&gt;Driver&lt;/b&gt;',
                            skills: ['&lt;img src=x onerror=alert(1)&gt;'],
                        }),
                    ],
                }),
            }),
            expect.any(Object)
        );
    });

    it('blocks unsupported or unauthorized field overwrite attempts', async () => {
        const app = buildApp();
        const forbidden = await request(app)
            .put('/api/users/profile')
            .send({
                firstName: 'Bob',
                city: 'Pune',
                activeRole: 'employer',
            });

        expect(forbidden.status).toBe(400);
        expect(forbidden.body.message).toMatch(/(unsupported fields|protected profile fields)/i);

        const roleMismatch = await request(app)
            .put('/api/users/profile')
            .set('x-role', 'employer')
            .send({
                firstName: 'Employer overwrite attempt',
                city: 'Pune',
            });

        expect(roleMismatch.status).toBe(400);
        expect(roleMismatch.body.message).toMatch(/unsupported fields/i);
    });
});
