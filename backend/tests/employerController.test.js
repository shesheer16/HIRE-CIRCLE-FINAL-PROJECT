jest.mock('../services/employerTierService', () => ({
    computeEmployerTierForEmployer: jest.fn(),
    getEmployerTier: jest.fn(),
}));

const {
    computeEmployerTierForEmployer,
    getEmployerTier,
} = require('../services/employerTierService');
const { getEmployerTierController } = require('../controllers/employerController');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('employerController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('uses cached tier path when refresh is not requested', async () => {
        getEmployerTier.mockResolvedValue({
            employerId: 'emp-1',
            tier: 'Gold',
            rankingBoostMultiplier: 1.03,
        });

        const req = {
            user: { _id: 'emp-1' },
            query: {},
        };
        const res = mockRes();

        await getEmployerTierController(req, res);

        expect(getEmployerTier).toHaveBeenCalledWith({
            employerId: 'emp-1',
            computeIfMissing: true,
        });
        expect(computeEmployerTierForEmployer).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ tier: 'Gold' }),
        }));
    });

    it('uses refresh computation path when refresh query is true', async () => {
        computeEmployerTierForEmployer.mockResolvedValue({
            employerId: 'emp-2',
            tier: 'Platinum',
            rankingBoostMultiplier: 1.05,
        });

        const req = {
            user: { _id: 'emp-2' },
            query: { refresh: 'true' },
        };
        const res = mockRes();

        await getEmployerTierController(req, res);

        expect(computeEmployerTierForEmployer).toHaveBeenCalledWith({
            employerId: 'emp-2',
            upsert: true,
        });
        expect(getEmployerTier).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ tier: 'Platinum' }),
        }));
    });
});
