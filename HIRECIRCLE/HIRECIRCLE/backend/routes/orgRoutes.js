const express = require('express');
const router = express.Router();
const { createOrganization, inviteMember, configureSSO, getOrganization } = require('../controllers/orgController');
const { protect } = require('../middleware/authMiddleware');

router.get('/:id', protect, getOrganization);
router.post('/', protect, createOrganization);
router.post('/invite', protect, inviteMember);
router.put('/sso', protect, configureSSO);

module.exports = router;
