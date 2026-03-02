const User = require('../../models/userModel');
const PaymentRecord = require('../../models/PaymentRecord');
const WebhookEventLog = require('../../models/WebhookEventLog');
const paymentService = require('../payments/paymentService');
const { logFinancialAction } = require('./auditLogService');
const {
    trackPaymentMethodFingerprint,
    detectPaymentFailurePattern,
    detectRapidRefundPattern,
} = require('./fraudDetectionService');
const {
    activateOrRenewSubscription,
    markSubscriptionPaymentFailed,
} = require('./subscriptionBillingService');
const MAX_FINANCIAL_AMOUNT = Number.parseFloat(process.env.MAX_FINANCIAL_AMOUNT || '10000000');

const normalizeAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid amount');
    }
    if (parsed > MAX_FINANCIAL_AMOUNT) {
        throw new Error('Amount exceeds maximum allowed threshold');
    }
    return Math.round(parsed * 100) / 100;
};

const normalizeCurrency = (currency = 'INR') => String(currency || 'INR').trim().toUpperCase();

const getAdminStatus = async (actorId) => {
    if (!actorId) return false;
    const actor = await User.findById(actorId).select('isAdmin').lean();
    return Boolean(actor?.isAdmin);
};

const createPaymentIntentRecord = async ({
    userId,
    provider,
    intentType,
    amount,
    currency,
    referenceId = null,
    idempotencyKey = null,
    metadata = {},
}) => {
    const normalizedAmount = normalizeAmount(amount);
    const normalizedCurrency = normalizeCurrency(currency);

    const providerResponse = await paymentService.createPaymentIntent({
        provider,
        amount: normalizedAmount,
        currency: normalizedCurrency,
        metadata: {
            ...metadata,
            referenceId: String(referenceId || ''),
            userId: String(userId),
            intentType,
        },
        idempotencyKey,
    });

    let record = null;
    let createdFresh = false;
    try {
        record = await PaymentRecord.create({
            userId,
            provider,
            intentType,
            referenceId: referenceId ? String(referenceId) : null,
            amount: normalizedAmount,
            currency: normalizedCurrency,
            status: providerResponse.status === 'succeeded' ? 'captured' : 'created',
            providerOrderId: providerResponse.providerOrderId || null,
            providerPaymentId: providerResponse.providerPaymentId || null,
            providerIntentId: providerResponse.providerIntentId || null,
            idempotencyKey,
            metadata: {
                ...metadata,
                providerPayload: providerResponse.raw,
            },
        });
        createdFresh = true;
    } catch (error) {
        if (Number(error?.code) !== 11000 || !idempotencyKey) {
            throw error;
        }

        record = await PaymentRecord.findOne({
            userId,
            intentType,
            idempotencyKey: String(idempotencyKey),
        });

        if (!record) {
            const conflict = new Error('Payment intent idempotency conflict');
            conflict.statusCode = 409;
            throw conflict;
        }
    }

    if (createdFresh) {
        await logFinancialAction({
            actorId: userId,
            actionType: 'payment.intent_created',
            referenceId: String(record._id),
            previousState: {},
            newState: {
                provider,
                intentType,
                amount: normalizedAmount,
                currency: normalizedCurrency,
                status: record.status,
            },
            metadata: {
                referenceId: referenceId ? String(referenceId) : null,
            },
        });
    }

    return {
        paymentRecord: record,
        providerResponse,
    };
};

const verifyPaymentRecord = async ({
    userId,
    paymentRecordId,
    provider,
    providerIntentId,
    providerOrderId,
    providerPaymentId,
    signature,
}) => {
    const record = await PaymentRecord.findById(paymentRecordId);
    if (!record) {
        const error = new Error('Payment record not found');
        error.statusCode = 404;
        throw error;
    }

    if (String(record.userId) !== String(userId)) {
        const error = new Error('Not authorized to verify this payment');
        error.statusCode = 403;
        throw error;
    }

    if (String(record.provider) !== String(provider || record.provider)) {
        const error = new Error('Payment provider mismatch');
        error.statusCode = 400;
        throw error;
    }

    const verification = await paymentService.verifyPayment({
        provider: record.provider,
        providerIntentId: providerIntentId || record.providerIntentId,
        providerOrderId: providerOrderId || record.providerOrderId,
        providerPaymentId: providerPaymentId || record.providerPaymentId,
        signature,
        amount: record.amount,
        currency: record.currency,
    });

    const previousState = record.toObject();

    record.providerIntentId = verification.providerIntentId || record.providerIntentId;
    record.providerOrderId = verification.providerOrderId || record.providerOrderId;
    record.providerPaymentId = verification.providerPaymentId || record.providerPaymentId;
    record.paymentMethodFingerprint = verification.paymentMethodFingerprint || record.paymentMethodFingerprint;
    record.status = verification.isVerified ? 'captured' : 'failed';
    record.metadata = {
        ...(record.metadata || {}),
        verificationPayload: verification.raw,
    };
    await record.save();

    if (record.paymentMethodFingerprint) {
        await trackPaymentMethodFingerprint({
            userId: record.userId,
            paymentRecordId: record._id,
            fingerprint: record.paymentMethodFingerprint,
        });
    }

    if (record.status === 'failed') {
        await detectPaymentFailurePattern({ userId: record.userId });
    }

    if (record.status === 'captured' && record.intentType === 'subscription') {
        const planType = String(record.metadata?.planType || 'pro');
        const providerSubscriptionId = verification.raw?.subscription || record.providerSubscriptionId || null;
        await activateOrRenewSubscription({
            userId: record.userId,
            provider: record.provider,
            planType,
            providerSubscriptionId,
            actorId: record.userId,
            metadata: {
                paymentRecordId: String(record._id),
            },
        });
    }

    await logFinancialAction({
        actorId: userId,
        actionType: 'payment.verified',
        referenceId: String(record._id),
        previousState,
        newState: {
            status: record.status,
            providerPaymentId: record.providerPaymentId,
            providerIntentId: record.providerIntentId,
        },
    });

    return {
        paymentRecord: record,
        verification,
    };
};

const persistWebhookEvent = async ({ provider, eventId, eventType, metadata = {} }) => {
    const result = await WebhookEventLog.updateOne(
        { provider, eventId },
        {
            $setOnInsert: {
                provider,
                eventId,
                eventType,
                metadata,
                processedAt: new Date(),
            },
        },
        { upsert: true }
    );

    return Number(result?.upsertedCount || 0) > 0;
};

const handleStripeWebhookEvent = async (event) => {
    const type = String(event.type || '');

    if (type === 'payment_intent.succeeded' || type === 'payment_intent.payment_failed' || type === 'payment_intent.canceled') {
        const intent = event.data.object;
        const statusMap = {
            'payment_intent.succeeded': 'captured',
            'payment_intent.payment_failed': 'failed',
            'payment_intent.canceled': 'cancelled',
        };

        const record = await PaymentRecord.findOne({ provider: 'stripe', providerIntentId: intent.id });
        if (record) {
            const previousState = record.toObject();
            record.status = statusMap[type];
            record.providerPaymentId = intent.latest_charge || record.providerPaymentId;
            record.paymentMethodFingerprint = intent.payment_method || record.paymentMethodFingerprint;
            record.metadata = {
                ...(record.metadata || {}),
                lastStripeWebhook: type,
            };
            await record.save();

            if (record.paymentMethodFingerprint) {
                await trackPaymentMethodFingerprint({
                    userId: record.userId,
                    paymentRecordId: record._id,
                    fingerprint: record.paymentMethodFingerprint,
                });
            }

            if (record.status === 'failed') {
                await detectPaymentFailurePattern({ userId: record.userId });
            }

            await logFinancialAction({
                actorId: record.userId,
                actionType: 'payment.webhook_status_updated',
                referenceId: String(record._id),
                previousState,
                newState: { status: record.status },
                metadata: { webhookType: type },
            });
        }
    }

    if (type === 'charge.refunded') {
        const charge = event.data.object;
        const record = await PaymentRecord.findOne({ provider: 'stripe', providerPaymentId: charge.id });
        if (record) {
            record.status = 'refunded';
            await record.save();
            await detectRapidRefundPattern({ userId: record.userId });
        }
    }

    if (type === 'checkout.session.completed') {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.client_reference_id) {
            await User.findByIdAndUpdate(session.client_reference_id, {
                $set: {
                    'subscription.stripeCustomerId': session.customer || null,
                    'subscription.stripeSubscriptionId': session.subscription || null,
                },
            });

            await activateOrRenewSubscription({
                userId: session.client_reference_id,
                provider: 'stripe',
                planType: String(session.metadata?.planType || 'pro'),
                providerSubscriptionId: session.subscription || null,
                metadata: {
                    stripeSessionId: session.id,
                    source: 'stripe_checkout_completed',
                },
            });
        }
    }

    if (type === 'invoice.paid') {
        const invoice = event.data.object;
        let user = null;
        if (invoice.customer) {
            user = await User.findOne({ 'subscription.stripeCustomerId': invoice.customer });
        }

        if (user) {
            await activateOrRenewSubscription({
                userId: user._id,
                provider: 'stripe',
                planType: 'pro',
                providerSubscriptionId: invoice.subscription || null,
                periodEnd: invoice.lines?.data?.[0]?.period?.end
                    ? new Date(Number(invoice.lines.data[0].period.end) * 1000)
                    : null,
                metadata: {
                    invoiceId: invoice.id,
                    source: 'stripe_invoice_paid',
                },
            });
        }
    }

    if (type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        let user = null;
        if (invoice.customer) {
            user = await User.findOne({ 'subscription.stripeCustomerId': invoice.customer });
        }

        await markSubscriptionPaymentFailed({
            userId: user?._id || null,
            providerSubscriptionId: invoice.subscription || null,
            metadata: {
                invoiceId: invoice.id,
                provider: 'stripe',
            },
        });
    }
};

const handleRazorpayWebhookEvent = async (payload) => {
    const type = String(payload.event || '');
    const paymentEntity = payload?.payload?.payment?.entity || {};

    if (type === 'payment.captured' || type === 'payment.failed') {
        const record = await PaymentRecord.findOne({
            provider: 'razorpay',
            $or: [
                { providerPaymentId: paymentEntity.id },
                { providerOrderId: paymentEntity.order_id },
            ],
        });

        if (record) {
            record.providerPaymentId = paymentEntity.id || record.providerPaymentId;
            record.providerOrderId = paymentEntity.order_id || record.providerOrderId;
            record.paymentMethodFingerprint = `${paymentEntity.method || 'unknown'}:${paymentEntity.card_id || paymentEntity.vpa || paymentEntity.id}`;
            record.status = type === 'payment.captured' ? 'captured' : 'failed';
            await record.save();

            if (record.paymentMethodFingerprint) {
                await trackPaymentMethodFingerprint({
                    userId: record.userId,
                    paymentRecordId: record._id,
                    fingerprint: record.paymentMethodFingerprint,
                });
            }

            if (record.status === 'failed') {
                await detectPaymentFailurePattern({ userId: record.userId });
            }
        }
    }

    if (type === 'refund.processed') {
        const refundEntity = payload?.payload?.refund?.entity || {};
        const record = await PaymentRecord.findOne({
            provider: 'razorpay',
            providerPaymentId: refundEntity.payment_id,
        });
        if (record) {
            record.status = 'refunded';
            await record.save();
            await detectRapidRefundPattern({ userId: record.userId });
        }
    }
};

const processWebhook = async ({ provider, rawBody, headers = {} }) => {
    const signatureHeader = provider === 'stripe'
        ? headers['stripe-signature']
        : headers['x-razorpay-signature'];

    const webhook = await paymentService.handleWebhook({
        provider,
        rawBody,
        signature: signatureHeader,
    });

    const shouldProcess = await persistWebhookEvent({
        provider,
        eventId: webhook.eventId,
        eventType: webhook.eventType,
        metadata: {},
    });

    if (!shouldProcess) {
        return {
            duplicate: true,
            eventId: webhook.eventId,
            eventType: webhook.eventType,
        };
    }

    if (provider === 'stripe') {
        await handleStripeWebhookEvent(webhook.payload);
    } else if (provider === 'razorpay') {
        await handleRazorpayWebhookEvent(webhook.payload);
    }

    return {
        duplicate: false,
        eventId: webhook.eventId,
        eventType: webhook.eventType,
    };
};

const refundPaymentRecord = async ({ actorId, paymentRecordId, amount = null, reason = 'manual_refund' }) => {
    const record = await PaymentRecord.findById(paymentRecordId);
    if (!record) {
        const error = new Error('Payment record not found');
        error.statusCode = 404;
        throw error;
    }

    const isOwner = String(actorId || '') === String(record.userId);
    const isAdmin = await getAdminStatus(actorId);
    if (!isOwner && !isAdmin) {
        const error = new Error('Not authorized to refund this payment');
        error.statusCode = 403;
        throw error;
    }

    if (record.status === 'refunded') {
        return {
            paymentRecord: record,
            providerRefund: null,
            alreadyRefunded: true,
        };
    }

    const previousState = record.toObject();

    const providerRefund = await paymentService.refundPayment({
        provider: record.provider,
        providerPaymentId: record.providerPaymentId,
        providerIntentId: record.providerIntentId,
        amount: amount || record.amount,
    });

    record.status = 'refunded';
    record.metadata = {
        ...(record.metadata || {}),
        refundReason: reason,
        providerRefund,
    };
    await record.save();

    await detectRapidRefundPattern({ userId: record.userId });

    await logFinancialAction({
        actorId,
        actionType: 'payment.refunded',
        referenceId: String(record._id),
        previousState,
        newState: {
            status: record.status,
        },
        metadata: {
            reason,
            providerRefundId: providerRefund.providerRefundId,
        },
    });

    return {
        paymentRecord: record,
        providerRefund,
        alreadyRefunded: false,
    };
};

module.exports = {
    createPaymentIntentRecord,
    verifyPaymentRecord,
    processWebhook,
    refundPaymentRecord,
};
