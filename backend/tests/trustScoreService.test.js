const { shouldBlockFlaggedAction } = require('../services/trustScoreService');

describe('trustScoreService flagged action gate', () => {
    test('does not block flagged users without abuse signals', () => {
        expect(shouldBlockFlaggedAction({
            reportCount: 0,
            otpAbuseCount: 0,
            rapidJobPostCount: 0,
            messageFloodCount: 0,
            spamBehaviorScore: 0,
            rejectedApplications: 0,
        })).toBe(false);
    });

    test('blocks when OTP abuse threshold is crossed', () => {
        expect(shouldBlockFlaggedAction({
            otpAbuseCount: 3,
        })).toBe(true);
    });

    test('blocks when rapid posting or message flood thresholds are crossed', () => {
        expect(shouldBlockFlaggedAction({
            rapidJobPostCount: 4,
        })).toBe(true);
        expect(shouldBlockFlaggedAction({
            messageFloodCount: 16,
        })).toBe(true);
    });
});
