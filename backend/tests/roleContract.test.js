const fs = require('fs');
const path = require('path');

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    countDocuments: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/Application', () => ({
    countDocuments: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/MatchFeedback', () => ({
    find: jest.fn(),
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

const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { employer: recruiterOnlyGuard } = require('../middleware/authMiddleware');
const { getLTVPrediction } = require('../controllers/analyticsController');
const { applyRoleContractToUser } = require('../utils/userRoleContract');

const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

const walkJsFiles = (dirPath) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) return walkJsFiles(fullPath);
        return entry.name.endsWith('.js') ? [fullPath] : [];
    });
};

describe('role contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('recruiter passes recruiter-only middleware', () => {
        const req = { user: { role: 'recruiter' } };
        const res = makeRes();
        const next = jest.fn();

        recruiterOnlyGuard(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('candidate is blocked from recruiter-only middleware', () => {
        const req = { user: { role: 'candidate' } };
        const res = makeRes();
        const next = jest.fn();

        recruiterOnlyGuard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Not authorized as an employer' });
    });

    it('has no legacy user-role employer literals outside roleGuards compatibility shim', () => {
        const backendRoot = path.join(__dirname, '..');
        const scanRoots = ['controllers', 'routes', 'middleware', 'services', 'workers']
            .map((segment) => path.join(backendRoot, segment));

        const files = scanRoots.flatMap((rootDir) => walkJsFiles(rootDir));
        const disallowedPatterns = [
            /req\.user\.role\s*[=!]==?\s*['"]employer['"]/,
            /user\.role\s*[=!]==?\s*['"]employer['"]/,
            /User\.(?:find|findOne|countDocuments|aggregate|updateOne|updateMany)\([\s\S]{0,220}?role\s*:\s*['"]employer['"]/,
        ];

        const violations = [];
        for (const filePath of files) {
            const source = fs.readFileSync(filePath, 'utf8');
            if (disallowedPatterns.some((pattern) => pattern.test(source))) {
                violations.push(path.relative(backendRoot, filePath));
            }
        }

        expect(violations).toEqual([]);
    });

    it('analytics recruiter segmentation follows recruiter role contract', async () => {
        User.findById.mockResolvedValue({
            _id: 'user-1',
            role: 'recruiter',
            subscription: { plan: 'pro' },
        });
        Job.countDocuments.mockResolvedValue(3);
        WorkerProfile.findOne.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            }),
        });
        Application.countDocuments.mockResolvedValue(0);

        const req = {
            params: { userId: 'user-1' },
            user: { _id: 'admin-1', isAdmin: true },
        };
        const res = makeRes();

        await getLTVPrediction(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            role: 'recruiter',
            predictedLTV: 950,
        }));
    });

    it('role switch recalculates capabilities instead of keeping stale deny flags', () => {
        const user = {
            _id: 'user-1',
            roles: ['worker', 'employer'],
            activeRole: 'worker',
            capabilities: {
                canPostJob: false,
                canCreateCommunity: true,
                canCreateBounty: false,
            },
        };

        applyRoleContractToUser(user, { activeRole: 'employer' });

        expect(user.activeRole).toBe('employer');
        expect(user.capabilities).toEqual(expect.objectContaining({
            canPostJob: true,
            canCreateCommunity: true,
            canCreateBounty: true,
        }));
    });
});
