jest.mock('../models/userModel', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/Job', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/Application', () => ({
  find: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
  find: jest.fn(),
}));

jest.mock('../models/ReputationProfile', () => ({
  find: jest.fn(),
}));

jest.mock('../models/WorkerEngagementScore', () => ({
  find: jest.fn(),
}));

jest.mock('../models/MatchFeedback', () => ({}));
jest.mock('../models/MatchRun', () => ({ create: jest.fn() }));
jest.mock('../models/MatchLog', () => ({ insertMany: jest.fn() }));
jest.mock('../config/redis', () => ({ isOpen: false }));
jest.mock('../controllers/notificationController', () => ({ createNotification: jest.fn() }));
jest.mock('../services/geminiService', () => ({ explainMatch: jest.fn() }));
jest.mock('../services/matchMetricsService', () => ({ recordMatchPerformanceMetric: jest.fn() }));
jest.mock('../match/matchEngineV2', () => ({
  rankWorkersForJob: jest.fn().mockReturnValue({ matches: [] }),
  sortScoredMatches: jest.fn(),
}));
jest.mock('../match/applyProbabilisticOverlay', () => ({ applyOverlay: jest.fn().mockResolvedValue(null) }));
jest.mock('../config/featureFlags', () => ({
  isMatchUiV1Enabled: jest.fn().mockReturnValue(true),
  isVerifiedPriorityEnabled: jest.fn().mockReturnValue(false),
}));
jest.mock('../services/matchQualityIntelligenceService', () => ({ buildMatchIntelligenceContext: jest.fn() }));
jest.mock('../services/matchIntentFilterService', () => ({ filterJobsByApplyIntent: jest.fn() }));
jest.mock('../services/workerEngagementService', () => ({ computeWorkerEngagementScore: jest.fn() }));
jest.mock('../services/growthNotificationService', () => ({ createAndSendBehaviorNotification: jest.fn() }));
jest.mock('../services/monetizationIntelligenceService', () => ({ recordFeatureUsage: jest.fn() }));
jest.mock('../utils/interviewLabels', () => ({ toProfileStrengthLabel: jest.fn(), toCommunicationLabel: jest.fn() }));
jest.mock('../services/adaptiveMatchWeightEngine', () => ({ recordMatchOutcomeAndAdapt: jest.fn() }));
jest.mock('../services/behavioralScoringEngine', () => ({
  buildBehaviorProfile: jest.fn(),
  getBehaviorProfile: jest.fn(),
  getBehaviorSignalsForMatch: jest.fn(),
}));
jest.mock('../services/hiringProbabilityEngine', () => ({
  predictHiringProbability: jest.fn(),
  getSimilarJobOutcomeSignals: jest.fn(),
}));
jest.mock('../services/decisionExplainabilityService', () => ({
  explainMatchDecision: jest.fn(),
  explainRankingDecision: jest.fn(),
}));
jest.mock('../services/geoMatchService', () => ({
  isCrossBorderAllowed: jest.fn().mockReturnValue(false),
  filterJobsByGeo: jest.fn(({ jobs }) => ({ jobs })),
  filterWorkersByGeo: jest.fn(({ workers }) => ({ workers })),
}));

const User = require('../models/userModel');
const Job = require('../models/Job');
const { getMatchesForEmployer } = require('../controllers/matchingController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('call security penetration', () => {
  it('rejects employer talent access for jobs they do not own', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ hasCompletedProfile: true }),
    });
    Job.findById.mockResolvedValue({
      _id: 'job-1',
      employerId: '507f191e810c19729de860eb',
    });

    const req = {
      params: { jobId: 'job-1' },
      user: { _id: '507f191e810c19729de860ff' },
      query: {},
    };
    const res = mockRes();

    await getMatchesForEmployer(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not authorized for this job' }));
  });
});
