const Offer = require('../models/Offer');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { transitionApplicationStatus } = require('../services/applicationWorkflowService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { recalculateReputationProfile } = require('../services/reputationEngineService');
const { isRecruiter } = require('../utils/roleGuards');

const OFFER_STATUS_MAP = Object.freeze({
    sent: 'offer_proposed',
    accepted: 'offer_accepted',
    declined: 'offer_rejected',
    cancelled: 'withdrawn',
});

const ACTIVE_OFFER_STATUSES = Object.freeze([
    'offer_proposed',
    'offer_countered',
    'offer_accepted',
    // Legacy compatibility.
    'sent',
    'accepted',
]);

const RESPONDABLE_OFFER_STATUSES = Object.freeze([
    'offer_proposed',
    'offer_countered',
    // Legacy compatibility.
    'sent',
]);

const parseDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeOfferStatus = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return OFFER_STATUS_MAP[raw] || raw;
};

const appendOfferHistory = (offer, {
    status,
    actorId = null,
    actorType = 'system',
    note = '',
} = {}) => {
    const history = Array.isArray(offer.history) ? offer.history : [];
    history.push({
        status,
        actorId: actorId || null,
        actorType,
        note: String(note || '').trim(),
        salaryOffered: Number.isFinite(Number(offer.salaryOffered)) ? Number(offer.salaryOffered) : null,
        at: new Date(),
    });
    offer.history = history.slice(-50);
};

const notifyOfferParties = async ({
    offer,
    application,
    workerUserId,
    title,
    message,
    notificationType = 'offer_update',
}) => {
    const payload = {
        applicationId: String(application._id),
        offerId: String(offer._id),
        jobId: String(application.job),
    };

    await Promise.all([
        queueNotificationDispatch({
            userId: application.employer,
            type: notificationType,
            title,
            message,
            relatedData: {
                ...payload,
                recipient: 'employer',
            },
            pushCategory: 'application_status',
        }),
        workerUserId ? queueNotificationDispatch({
            userId: workerUserId,
            type: notificationType,
            title,
            message,
            relatedData: {
                ...payload,
                recipient: 'worker',
            },
            pushCategory: 'application_status',
        }) : Promise.resolve(),
    ]);
};

const queueLifecycleAutomation = async ({ offerId, reason }) => enqueueBackgroundJob({
    type: 'lifecycle_automation',
    payload: {
        offerId: String(offerId),
        reason: reason || 'offer_update',
    },
});

const createOffer = async (req, res) => {
    try {
        const { applicationId, salaryOffered, terms, expiryDate, escrowEnabled } = req.body || {};
        if (!applicationId || !Number.isFinite(Number(salaryOffered)) || !String(terms || '').trim() || !expiryDate) {
            return res.status(400).json({ message: 'applicationId, salaryOffered, terms and expiryDate are required' });
        }

        const expiry = parseDate(expiryDate);
        if (!expiry || expiry <= new Date()) {
            return res.status(400).json({ message: 'expiryDate must be a valid future date' });
        }

        const application = await Application.findById(applicationId).select('_id job employer worker status isArchived');
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }
        if (application.isArchived) {
            return res.status(409).json({ message: 'Cannot create offer on archived application' });
        }
        if (String(application.employer) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the employer can create offers' });
        }

        const existingActiveOffer = await Offer.findOne({
            applicationId: application._id,
            status: { $in: ACTIVE_OFFER_STATUSES },
        }).select('_id status');
        if (existingActiveOffer) {
            return res.status(409).json({ message: 'Active offer already exists for this application' });
        }

        const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
        const offer = await Offer.create({
            applicationId: application._id,
            jobId: application.job,
            employerId: application.employer,
            candidateId: application.worker,
            salaryOffered: Number(salaryOffered),
            terms: String(terms).trim(),
            expiryDate: expiry,
            escrowEnabled: Boolean(escrowEnabled),
            status: 'offer_proposed',
            history: [{
                status: 'offer_proposed',
                actorId: req.user._id,
                actorType: 'employer',
                note: 'Offer proposed by employer',
                salaryOffered: Number(salaryOffered),
                at: new Date(),
            }],
        });

        await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'offer_sent',
            actorType: 'employer',
            actorId: req.user._id,
            reason: 'offer_created',
            metadata: {
                offerId: String(offer._id),
            },
        });

        await notifyOfferParties({
            offer,
            application,
            workerUserId: workerProfile?.user || null,
            title: 'Offer sent',
            message: 'An offer has been sent and is awaiting response.',
        });

        await queueLifecycleAutomation({
            offerId: offer._id,
            reason: 'offer_created',
        });
        setImmediate(() => {
            recalculateReputationProfile({
                userId: application.employer,
                reason: 'offer_created',
            }).catch(() => {});
            if (workerProfile?.user) {
                recalculateReputationProfile({
                    userId: workerProfile.user,
                    reason: 'offer_created',
                }).catch(() => {});
            }
        });

        return res.status(201).json({
            success: true,
            data: offer,
        });
    } catch (error) {
        if (error?.code === 'INVALID_STATUS_TRANSITION') {
            return res.status(409).json({ message: error.message, details: error.details || null });
        }
        return res.status(500).json({ message: 'Failed to create offer' });
    }
};

const respondToOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        const action = String(req.body?.action || '').trim().toLowerCase();
        if (!['accept', 'decline'].includes(action)) {
            return res.status(400).json({ message: 'action must be accept or decline' });
        }

        const offer = await Offer.findById(offerId);
        if (!offer) {
            return res.status(404).json({ message: 'Offer not found' });
        }
        const currentStatus = normalizeOfferStatus(offer.status);
        if (!RESPONDABLE_OFFER_STATUSES.includes(currentStatus)) {
            return res.status(409).json({ message: `Offer is already ${offer.status}` });
        }

        const application = await Application.findById(offer.applicationId);
        if (!application) {
            return res.status(404).json({ message: 'Application not found for offer' });
        }

        const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
        if (String(workerProfile?.user || '') !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the candidate can respond to this offer' });
        }

        const now = new Date();
        if (action === 'accept') {
            offer.status = 'offer_accepted';
            offer.acceptedAt = now;
            offer.isLocked = true;
            appendOfferHistory(offer, {
                status: 'offer_accepted',
                actorId: req.user._id,
                actorType: 'candidate',
                note: 'Offer accepted by candidate',
            });
            await offer.save();

            await transitionApplicationStatus({
                applicationDoc: application,
                nextStatus: 'offer_accepted',
                actorType: 'worker',
                actorId: req.user._id,
                reason: 'offer_accepted',
                metadata: {
                    offerId: String(offer._id),
                },
            });
        } else {
            offer.status = 'offer_rejected';
            offer.declinedAt = now;
            appendOfferHistory(offer, {
                status: 'offer_rejected',
                actorId: req.user._id,
                actorType: 'candidate',
                note: 'Offer rejected by candidate',
            });
            await offer.save();

            await transitionApplicationStatus({
                applicationDoc: application,
                nextStatus: 'offer_declined',
                actorType: 'worker',
                actorId: req.user._id,
                reason: 'offer_declined',
                metadata: {
                    offerId: String(offer._id),
                },
            });
        }

        await notifyOfferParties({
            offer,
            application,
            workerUserId: workerProfile.user,
            title: action === 'accept' ? 'Offer accepted' : 'Offer declined',
            message: action === 'accept'
                ? 'Candidate accepted the offer.'
                : 'Candidate declined the offer.',
        });

        await queueLifecycleAutomation({
            offerId: offer._id,
            reason: `offer_${action}`,
        });
        setImmediate(() => {
            recalculateReputationProfile({
                userId: application.employer,
                reason: `offer_${action}`,
            }).catch(() => {});
            recalculateReputationProfile({
                userId: workerProfile.user,
                reason: `offer_${action}`,
            }).catch(() => {});
        });

        return res.json({
            success: true,
            data: offer,
        });
    } catch (error) {
        if (error?.code === 'INVALID_STATUS_TRANSITION') {
            return res.status(409).json({ message: error.message, details: error.details || null });
        }
        return res.status(500).json({ message: 'Failed to update offer response' });
    }
};

const listOffers = async (req, res) => {
    try {
        const query = {};
        if (isRecruiter(req.user)) {
            query.employerId = req.user._id;
        } else {
            const workerProfile = await WorkerProfile.findOne({ user: req.user._id }).select('_id');
            if (!workerProfile) {
                return res.json({ success: true, count: 0, data: [] });
            }
            query.candidateId = workerProfile._id;
        }

        if (req.query.applicationId) {
            query.applicationId = req.query.applicationId;
        }
        if (req.query.status) {
            query.status = normalizeOfferStatus(req.query.status);
        }

        const offers = await Offer.find(query)
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({
            success: true,
            count: offers.length,
            data: offers,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch offers' });
    }
};

const expireOfferById = async ({ offerId, reason = 'offer_expired', actorType = 'automation' }) => {
    const offer = await Offer.findById(offerId);
    if (!offer || !RESPONDABLE_OFFER_STATUSES.includes(normalizeOfferStatus(offer.status))) {
        return null;
    }

    offer.status = 'expired';
    offer.expiredAt = new Date();
    appendOfferHistory(offer, {
        status: 'expired',
        actorType,
        note: reason,
    });
    await offer.save();

    const application = await Application.findById(offer.applicationId);
    if (application) {
        await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'offer_declined',
            actorType,
            reason,
            metadata: {
                offerId: String(offer._id),
            },
        });
    }

    return offer;
};

const counterOffer = async (req, res) => {
    try {
        const offerId = String(req.params.id || '').trim();
        const salaryOffered = Number(req.body?.salaryOffered);
        const terms = String(req.body?.terms || '').trim();
        if (!offerId || !Number.isFinite(salaryOffered) || salaryOffered <= 0) {
            return res.status(400).json({ message: 'Valid salaryOffered is required' });
        }

        const offer = await Offer.findById(offerId);
        if (!offer) return res.status(404).json({ message: 'Offer not found' });
        const currentStatus = normalizeOfferStatus(offer.status);
        if (!RESPONDABLE_OFFER_STATUSES.includes(currentStatus)) {
            return res.status(409).json({ message: `Cannot counter offer in status ${offer.status}` });
        }

        const application = await Application.findById(offer.applicationId).select('_id employer worker');
        if (!application) return res.status(404).json({ message: 'Application not found for offer' });

        const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
        if (String(workerProfile?.user || '') !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the candidate can counter this offer' });
        }

        offer.status = 'offer_countered';
        offer.counteredAt = new Date();
        offer.salaryOffered = salaryOffered;
        if (terms) {
            offer.terms = terms;
        }
        appendOfferHistory(offer, {
            status: 'offer_countered',
            actorId: req.user._id,
            actorType: 'candidate',
            note: 'Candidate submitted a counter offer',
        });
        await offer.save();

        await notifyOfferParties({
            offer,
            application,
            workerUserId: workerProfile?.user || null,
            title: 'Offer countered',
            message: 'Candidate submitted a counter offer.',
            notificationType: 'offer_countered',
        });

        await queueLifecycleAutomation({
            offerId: offer._id,
            reason: 'offer_countered',
        });
        setImmediate(() => {
            recalculateReputationProfile({
                userId: application.employer,
                reason: 'offer_countered',
            }).catch(() => {});
            if (workerProfile?.user) {
                recalculateReputationProfile({
                    userId: workerProfile.user,
                    reason: 'offer_countered',
                }).catch(() => {});
            }
        });

        return res.status(200).json({
            success: true,
            data: offer,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to counter offer' });
    }
};

const proposeOffer = createOffer;
const acceptOffer = async (req, res) => {
    req.body = {
        ...(req.body || {}),
        action: 'accept',
    };
    return respondToOffer(req, res);
};

const rejectOffer = async (req, res) => {
    req.body = {
        ...(req.body || {}),
        action: 'decline',
    };
    return respondToOffer(req, res);
};

module.exports = {
    proposeOffer,
    counterOffer,
    acceptOffer,
    rejectOffer,
    createOffer,
    respondToOffer,
    listOffers,
    expireOfferById,
};
