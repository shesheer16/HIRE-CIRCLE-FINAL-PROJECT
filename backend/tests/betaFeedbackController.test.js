jest.mock('../models/BetaFeedback', () => ({
    create: jest.fn(),
    find: jest.fn(),
}));

const BetaFeedback = require('../models/BetaFeedback');
const { getFeedback } = require('../controllers/betaFeedbackController');

const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

describe('betaFeedbackController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns cursor-paginated admin feedback payload', async () => {
        BetaFeedback.find.mockReturnValue({
            populate: () => ({
                sort: () => ({
                    limit: async () => ([
                        { _id: '507f191e810c19729de860ea', message: 'A' },
                        { _id: '507f191e810c19729de860eb', message: 'B' },
                        { _id: '507f191e810c19729de860ec', message: 'C' },
                    ]),
                }),
            }),
        });

        const req = { query: { limit: '2' } };
        const res = makeRes();

        await getFeedback(req, res);

        expect(BetaFeedback.find).toHaveBeenCalledWith({});
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            count: 2,
            hasMore: true,
            nextCursor: '507f191e810c19729de860eb',
        }));
    });

    it('blocks invalid cursor input', async () => {
        const req = { query: { cursor: 'invalid-cursor' } };
        const res = makeRes();

        await getFeedback(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Invalid cursor' });
        expect(BetaFeedback.find).not.toHaveBeenCalled();
    });
});
