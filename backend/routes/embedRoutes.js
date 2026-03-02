const express = require('express');

const { renderMatchWidget } = require('../controllers/embedController');
const { serveHireWidgetScript } = require('../controllers/widgetController');

const router = express.Router();

router.get('/match-widget', renderMatchWidget);
router.get('/hire-widget.js', serveHireWidgetScript);

module.exports = router;
