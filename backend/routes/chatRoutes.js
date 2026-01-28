const express = require('express');
const router = express.Router();
const { getChatHistory, sendMessageREST } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.get('/:applicationId', protect, getChatHistory);
router.post('/', protect, sendMessageREST);

module.exports = router;
