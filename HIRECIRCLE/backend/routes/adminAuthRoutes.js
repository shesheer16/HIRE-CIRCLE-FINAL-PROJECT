const express = require('express');

const { adminLogin, bootstrapAdmin } = require('../controllers/adminAuthController');

const router = express.Router();

router.post('/login', adminLogin);
router.post('/bootstrap', bootstrapAdmin);

module.exports = router;
