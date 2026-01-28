const express = require('express');
const router = express.Router();
const { getMatchesForEmployer, getMatchesForCandidate } = require('../controllers/matchingController');
const { protect } = require('../middleware/authMiddleware');

router.get('/employer/:jobId', protect, getMatchesForEmployer);
router.get('/candidate', protect, getMatchesForCandidate);

module.exports = router;
