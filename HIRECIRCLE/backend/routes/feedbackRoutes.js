const express = require('express');
const router = express.Router();
const { submitFeedback } = require('../controllers/betaFeedbackController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, submitFeedback);

module.exports = router;
