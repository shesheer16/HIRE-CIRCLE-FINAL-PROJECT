const express = require('express');
const router = express.Router();
const {
    protectApiKey,
    getPublicJobsList,
    getPublicProfileView,
    registerWebhook,
} = require('../controllers/publicApiController');

router.use(protectApiKey);

router.get('/jobs', getPublicJobsList);
router.get('/profile/:userId', getPublicProfileView);
router.post('/webhooks', registerWebhook);

module.exports = router;
