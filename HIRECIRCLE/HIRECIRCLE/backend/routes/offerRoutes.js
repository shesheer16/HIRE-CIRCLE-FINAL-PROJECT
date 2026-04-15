const express = require('express');
const router = express.Router();
const { protect, employer } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
    offerCreateSchema,
    offerRespondSchema,
} = require('../schemas/requestSchemas');
const {
    createOffer,
    respondToOffer,
    listOffers,
    proposeOffer,
    counterOffer,
    acceptOffer,
    rejectOffer,
} = require('../controllers/offerController');

router.get('/', protect, listOffers);
router.post('/', protect, employer, validate({ body: offerCreateSchema }), createOffer);
router.post('/propose', protect, employer, validate({ body: offerCreateSchema }), proposeOffer);
router.post('/:id/counter', protect, counterOffer);
router.post('/:id/accept', protect, acceptOffer);
router.post('/:id/reject', protect, rejectOffer);
router.put('/:id/respond', protect, validate({ body: offerRespondSchema }), respondToOffer);

module.exports = router;
