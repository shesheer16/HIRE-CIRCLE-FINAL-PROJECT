jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
    updateOne: jest.fn(),
    exists: jest.fn(),
}));

jest.mock('../models/Referral', () => ({
    find: jest.fn(),
}));

const User = require('../models/userModel');
const Referral = require('../models/Referral');
const { getReferralDashboard } = require('../services/referralService');

describe('profile referral dashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns referral dashboard with accurate counts and reward totals', async () => {
        User.findById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: '507f191e810c19729de860af',
                    referralCode: 'ABCD1234',
                    subscription: { credits: 7 },
                }),
            }),
        });
        Referral.find.mockReturnValue({
            sort: () => ({
                lean: async () => ([
                    { status: 'completed', rewardType: 'credit_unlock' },
                    { status: 'completed', rewardType: 'premium_unlock' },
                    { status: 'pending', rewardType: 'referral_bonus' },
                    { status: 'in_progress', rewardType: 'credit_unlock' },
                ]),
            }),
        });

        const dashboard = await getReferralDashboard({ userId: '507f191e810c19729de860af' });

        expect(dashboard.referralCode).toBe('ABCD1234');
        expect(dashboard.totalReferrals).toBe(4);
        expect(dashboard.completedReferrals).toBe(2);
        expect(dashboard.pendingReferrals).toBe(2);
        expect(dashboard.creditsEarned).toBe(7);
        expect(dashboard.rewardsGranted).toBe(4);
        expect(dashboard.inviteLink).toContain('ABCD1234');
    });

    it('returns null when user is not found', async () => {
        User.findById.mockReturnValue({
            select: () => ({
                lean: async () => null,
            }),
        });

        const dashboard = await getReferralDashboard({ userId: '507f191e810c19729de860b0' });
        expect(dashboard).toBeNull();
    });
});
