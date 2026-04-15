const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { applyJobLimiter } = require('../middleware/rateLimiters');
const { validateApplicationTransition } = require('../middleware/applicationTransitionGuard');
const { applicationCreateSchema, applicationStatusUpdateSchema } = require('../schemas/requestSchemas');
const { trustGuard } = require('../middleware/trustGuardMiddleware');
const { abuseDefenseGuard } = require('../middleware/abuseDefenseMiddleware');
const { sendRequest, updateStatus, getApplications, getApplicationById } = require('../controllers/applicationController');

/**
 * @swagger
 * /api/applications/{id}/status:
 *   put:
 *     summary: Update application status
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       404:
 *         description: Application not found
 */
router.route('/')
    .post(protect, trustGuard('application_submit'), abuseDefenseGuard('application_submit'), applyJobLimiter, validate({ body: applicationCreateSchema }), sendRequest)
    .get(protect, getApplications);

router.route('/:id')
    .get(protect, getApplicationById);

router.route('/:id/status')
    .put(
        protect,
        validate({ body: applicationStatusUpdateSchema }),
        validateApplicationTransition,
        updateStatus
    );

module.exports = router;
