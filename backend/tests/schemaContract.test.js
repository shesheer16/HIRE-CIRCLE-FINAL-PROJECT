const fs = require('fs');
const path = require('path');

jest.mock('../models/Job', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
}));

jest.mock('../models/Application', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    collection: { name: 'applications' },
}));

jest.mock('../models/MatchFeedback', () => ({
    find: jest.fn(),
    collection: { name: 'matchfeedbacks' },
}));

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/AnalyticsEvent', () => ({
    distinct: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/ConversionMilestone', () => ({
    find: jest.fn(),
}));

jest.mock('../models/HiringLifecycleEvent', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../models/RevenueEvent', () => ({
    aggregate: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/CityHiringDailySnapshot', () => ({
    find: jest.fn(),
}));

jest.mock('../services/matchMetricsService', () => ({
    getMatchQualityAnalytics: jest.fn(),
}));

jest.mock('../config/matchQualityTargets', () => ({
    getMatchQualityTargets: jest.fn(() => ({
        interviewRateTarget: 0.1,
        postInterviewHireRateTarget: 0.35,
        offerAcceptanceTarget: 0.78,
    })),
}));

const Job = require('../models/Job');
const Application = require('../models/Application');
const MatchFeedback = require('../models/MatchFeedback');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');

const {
    getEmployerHiringFunnel,
    getEmployerJobPerformance,
    getLTVPrediction,
} = require('../controllers/analyticsController');

const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

describe('schema contract guardrails', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not use legacy Application field names in analytics queries', () => {
        const analyticsControllerPath = path.join(__dirname, '..', 'controllers', 'analyticsController.js');
        const source = fs.readFileSync(analyticsControllerPath, 'utf8');

        const legacyPatterns = [
            /Application\.find\(\s*\{\s*jobId\s*:/s,
            /Application\.findOne\(\s*\{\s*jobId\s*:/s,
            /Application\.countDocuments\(\s*\{\s*jobId\s*:/s,
            /Application\.find\(\s*\{\s*candidateId\s*:/s,
            /Application\.findOne\(\s*\{\s*candidateId\s*:/s,
            /Application\.countDocuments\(\s*\{\s*candidateId\s*:/s,
        ];

        legacyPatterns.forEach((pattern) => {
            expect(source).not.toMatch(pattern);
        });
    });

    it('uses aggregate pipeline for employer funnel without per-job loops', async () => {
        const employerId = '507f191e810c19729de860ea';
        Job.countDocuments.mockResolvedValue(2);
        Application.aggregate.mockResolvedValue([{ applied: 2, offered: 1, hired: 1, shortlisted: 1, interviewed: 0 }]);

        const req = {
            params: { employerId },
            user: { _id: { toString: () => employerId }, isAdmin: false },
        };
        const res = makeRes();

        await getEmployerHiringFunnel(req, res);

        expect(Job.countDocuments).toHaveBeenCalled();
        expect(Application.aggregate).toHaveBeenCalled();
        const pipeline = Application.aggregate.mock.calls[0][0];
        expect(JSON.stringify(pipeline)).toContain('unionWith');
        expect(JSON.stringify(pipeline)).toContain('"$status"');
    });

    it('uses aggregation lookup for employer job performance query', async () => {
        const employerId = '507f191e810c19729de860eb';
        Job.aggregate.mockResolvedValue([
            { _id: 'job-1', title: 'Driver', isOpen: true, createdAt: new Date(), applications: 2, avgMatchScore: 87 },
        ]);

        const req = {
            params: { employerId },
            user: { _id: { toString: () => employerId }, isAdmin: false },
        };
        const res = makeRes();

        await getEmployerJobPerformance(req, res);

        expect(Job.aggregate).toHaveBeenCalled();
        const pipeline = Job.aggregate.mock.calls[0][0];
        expect(JSON.stringify(pipeline)).toContain('"$lookup"');
        expect(JSON.stringify(pipeline)).toContain('"applications"');
    });

    it('uses WorkerProfile mapping before Application.worker count in LTV calculation', async () => {
        User.findById.mockResolvedValue({
            _id: 'user-1',
            role: 'candidate',
            subscription: { plan: 'free' },
        });
        WorkerProfile.findOne.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({ _id: 'worker-profile-1' }),
            }),
        });
        Job.countDocuments.mockResolvedValue(0);
        Application.countDocuments.mockResolvedValue(3);

        const req = {
            params: { userId: 'user-1' },
            user: { _id: 'admin-1', isAdmin: true },
        };
        const res = makeRes();

        await getLTVPrediction(req, res);

        expect(WorkerProfile.findOne).toHaveBeenCalledWith({ user: 'user-1' });
        expect(Application.countDocuments).toHaveBeenCalledWith({ worker: 'worker-profile-1' });
    });
});
