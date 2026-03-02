const Application = require('../models/Application');
const {
    normalizeApplicationStatus,
    isCanonicalApplicationStatus,
    canTransition,
} = require('../workflow/applicationStateMachine');

const validateApplicationTransition = async (req, res, next) => {
    try {
        const applicationId = String(req.params.id || '').trim();
        const requestedRawStatus = req.body?.status;
        const normalizedTarget = normalizeApplicationStatus(requestedRawStatus, '__invalid__');

        if (!isCanonicalApplicationStatus(normalizedTarget)) {
            return res.status(400).json({
                message: 'Invalid status',
                details: `Unsupported application status: ${String(requestedRawStatus || '')}`,
            });
        }

        const application = await Application.findById(applicationId);
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }

        const fromStatus = normalizeApplicationStatus(application.status, 'applied');
        const transition = canTransition({
            fromStatus,
            toStatus: normalizedTarget,
            allowNoop: true,
        });

        if (!transition.valid) {
            return res.status(409).json({
                message: 'Invalid status transition',
                details: transition.reason,
                fromStatus: transition.fromStatus,
                toStatus: transition.toStatus,
            });
        }

        req.body.status = normalizedTarget;
        req.applicationTransition = {
            application,
            fromStatus,
            toStatus: normalizedTarget,
        };
        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    validateApplicationTransition,
};

