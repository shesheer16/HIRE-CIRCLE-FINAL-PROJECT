const express = require('express');

const { serveHireSdkV1 } = require('../controllers/sdkController');

const router = express.Router();

router.get('/hire-sdk.v1.js', serveHireSdkV1);

module.exports = router;
