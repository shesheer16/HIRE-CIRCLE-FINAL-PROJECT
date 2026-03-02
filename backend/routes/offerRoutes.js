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
} = require('../controllers/offerController');

router.get('/', protect, listOffers);
router.post('/', protect, employer, validate({ body: offerCreateSchema }), createOffer);
router.put('/:id/respond', protect, validate({ body: offerRespondSchema }), respondToOffer);

module.exports = router;

