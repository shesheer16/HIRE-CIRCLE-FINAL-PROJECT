jest.mock('../models/Job', () => ({
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
}));

jest.mock('../models/Application', () => ({
    aggregate: jest.fn(),
    collection: { name: 'applications' },
}));

jest.mock('../models/MatchFeedback', () => ({
    collection: { name: 'matchfeedbacks' },
}));

jest.mock('../models/userModel', () => ({}));
jest.mock('../models/WorkerProfile', () => ({}));
jest.mock('../models/AnalyticsEvent', () => ({}));
jest.mock('../models/ConversionMilestone', () => ({}));
jest.mock('../models/HiringLifecycleEvent', () => ({}));
jest.mock('../models/RevenueEvent', () => ({}));
jest.mock('../models/CityHiringDailySnapshot', () => ({}));
jest.mock('../services/matchMetricsService', () => ({
    getMatchQualityAnalytics: jest.fn(),
}));

const Job = require('../models/Job');
const Application = require('../models/Application');
const {
    getEmployerHiringFunnel,
    getEmployerJobPerformance,
} = require('../controllers/analyticsController');

const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

describe('analytics query budget', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('keeps employer funnel endpoint within two DB queries', async () => {
        Job.countDocuments.mockResolvedValue(3);
        Application.aggregate.mockResolvedValue([{ applied: 10, shortlisted: 2, interviewed: 1, offered: 3, hired: 1 }]);

        const employerId = '507f191e810c19729de860ea';
        const req = {
            params: { employerId },
            user: { _id: { toString: () => employerId }, isAdmin: false },
        };
        const res = makeRes();

        await getEmployerHiringFunnel(req, res);

        expect(Job.countDocuments).toHaveBeenCalledTimes(1);
        expect(Application.aggregate).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalledWith(500);
    });

    it('keeps employer job performance endpoint within one DB query', async () => {
        Job.aggregate.mockResolvedValue([
            { _id: 'job-1', title: 'Cook', isOpen: true, createdAt: new Date(), applications: 4, avgMatchScore: 80 },
        ]);

        const employerId = '507f191e810c19729de860eb';
        const req = {
            params: { employerId },
            user: { _id: { toString: () => employerId }, isAdmin: false },
        };
        const res = makeRes();

        await getEmployerJobPerformance(req, res);

        expect(Job.aggregate).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalledWith(500);
    });
});
