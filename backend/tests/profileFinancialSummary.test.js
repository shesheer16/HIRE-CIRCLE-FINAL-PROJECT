jest.mock('../services/financial/walletService', () => ({
    getWallet: jest.fn(),
    getWalletTransactions: jest.fn(),
    settlePendingBalance: jest.fn(),
    updateWalletKycStatus: jest.fn(),
}));

const { getWallet } = require('../services/financial/walletService');
const { getMyWallet } = require('../controllers/financialController');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('profile financial summary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns wallet summary for authenticated user only', async () => {
        getWallet.mockResolvedValue({
            userId: '507f191e810c19729de860b1',
            balance: 1200,
            pendingBalance: 350,
            currency: 'INR',
        });

        const req = {
            user: { _id: '507f191e810c19729de860b1' },
            params: { userId: '507f191e810c19729de860ff' },
        };
        const res = makeRes();

        await getMyWallet(req, res);

        expect(getWallet).toHaveBeenCalledWith({ userId: '507f191e810c19729de860b1' });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            wallet: expect.objectContaining({
                balance: 1200,
                pendingBalance: 350,
                currency: 'INR',
            }),
        });
    });

    it('never returns negative wallet balances in profile summary payload', async () => {
        getWallet.mockResolvedValue({
            userId: '507f191e810c19729de860b2',
            balance: -50,
            pendingBalance: -20,
            currency: 'INR',
        });

        const req = {
            user: { _id: '507f191e810c19729de860b2' },
        };
        const res = makeRes();

        await getMyWallet(req, res);

        expect(res.json).toHaveBeenCalledWith({
            wallet: expect.objectContaining({
                balance: 0,
                pendingBalance: 0,
            }),
        });
    });
});
