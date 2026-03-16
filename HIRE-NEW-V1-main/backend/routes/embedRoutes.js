const express = require('express');

const { renderMatchWidget } = require('../controllers/embedController');
const {
    bootstrapWidgetSessionController,
    serveHireWidgetScript,
} = require('../controllers/widgetController');

const router = express.Router();

router.get('/match-widget', renderMatchWidget);
router.get('/hire-widget.js', serveHireWidgetScript);
router.post('/widget-bootstrap', bootstrapWidgetSessionController);

module.exports = router;
