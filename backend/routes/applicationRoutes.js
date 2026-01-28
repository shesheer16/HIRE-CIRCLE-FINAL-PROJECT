const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { sendRequest, updateStatus, getApplications, getApplicationById } = require('../controllers/applicationController');

router.route('/')
    .post(protect, sendRequest)
    .get(protect, getApplications);

router.route('/:id')
    .get(protect, getApplicationById);

router.route('/:id/status')
    .put(protect, updateStatus);

module.exports = router;
