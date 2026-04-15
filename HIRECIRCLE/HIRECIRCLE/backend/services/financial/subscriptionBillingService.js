const Stripe = require('stripe');
const User = require('../../models/userModel');
const Subscription = require('../../models/Subscription');
const { logFinancialAction } = require('./auditLogService');

const SUBSCRIPTION_DURATION_DAYS = Number.parseInt(process.env.SUBSCRIPTION_DURATION_DAYS || '30', 10);
const GRACE_DAYS = Number.parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '3', 10);

const addDays = (date, days) => new Date(new Date(date).getTime() + (days * 24 * 60 * 60 * 1000));

const getStripeClient = () => {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!key) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return new Stripe(key);
};

const resolveStripePriceId = (planType = 'pro') => {
    const normalized = String(planType || 'pro').toLowerCase();
    if (normalized === 'enterprise') {
        return String(process.env.STRIPE_PRICE_ENTERPRISE || '').trim();
    }
    if (normalized === 'pro') {
        return String(process.env.STRIPE_PRICE_PRO || '').trim();
    }
    return '';
};

const upsertSubscriptionState = async ({
    userId,
    provider,
    planType,
    providerSubscriptionId,
    expiryDate,
    gracePeriodEndsAt = null,
    metadata = {},
}) => {
    const status = gracePeriodEndsAt ? 'grace' : 'active';

    const subscription = await Subscription.findOneAndUpdate(
        { userId },
        {
            $set: {
                userId,
                planType,
                status,
                provider,
                providerSubscriptionId: providerSubscriptionId || null,
                billingPeriod: 'monthly',
                startDate: new Date(),
                expiryDate,
                gracePeriodEndsAt,
                metadata,
            },
        },
        { returnDocument: 'after', upsert: true }
    );

    await User.findByIdAndUpdate(userId, {
        $set: {
            'subscription.plan': planType,
            'subscription.billingPeriod': planType === 'free' ? 'none' : 'monthly',
            'subscription.nextBillingDate': expiryDate,
            ...(providerSubscriptionId ? { 'subscription.stripeSubscriptionId': providerSubscriptionId } : {}),
        },
    });

    return subscription;
};

const createSubscriptionCheckoutSession = async ({ user, planType = 'pro', successUrl, cancelUrl }) => {
    const stripe = getStripeClient();
    const priceId = resolveStripePriceId(planType);

    if (!priceId) {
        throw new Error('Stripe price id is not configured for this plan');
    }

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: user.email,
        client_reference_id: String(user._id),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: String(successUrl),
        cancel_url: String(cancelUrl),
        metadata: {
            planType,
            userId: String(user._id),
        },
    });

    return {
        sessionId: session.id,
        sessionUrl: session.url,
    };
};

const activateOrRenewSubscription = async ({
    userId,
    provider = 'stripe',
    planType = 'pro',
    providerSubscriptionId = null,
    periodEnd = null,
    actorId = null,
    metadata = {},
}) => {
    const expiryDate = periodEnd ? new Date(periodEnd) : addDays(new Date(), SUBSCRIPTION_DURATION_DAYS);
    const subscription = await upsertSubscriptionState({
        userId,
        provider,
        planType,
        providerSubscriptionId,
        expiryDate,
        gracePeriodEndsAt: null,
        metadata,
    });

    await logFinancialAction({
        actorId: actorId || userId,
        actionType: 'subscription.renewed',
        referenceId: String(subscription._id),
        previousState: {},
        newState: {
            status: subscription.status,
            expiryDate: subscription.expiryDate,
            planType: subscription.planType,
        },
        metadata,
    });

    return subscription;
};

const markSubscriptionPaymentFailed = async ({ userId, providerSubscriptionId = null, metadata = {} }) => {
    let subscription = null;

    if (providerSubscriptionId) {
        subscription = await Subscription.findOne({ providerSubscriptionId });
    }

    if (!subscription && userId) {
        subscription = await Subscription.findOne({ userId });
    }

    if (!subscription) {
        return null;
    }

    const gracePeriodEndsAt = addDays(new Date(), GRACE_DAYS);
    subscription.status = 'grace';
    subscription.gracePeriodEndsAt = gracePeriodEndsAt;
    subscription.metadata = {
        ...(subscription.metadata || {}),
        lastFailure: new Date().toISOString(),
        ...metadata,
    };

    await subscription.save();

    await User.findByIdAndUpdate(subscription.userId, {
        $set: {
            'subscription.nextBillingDate': gracePeriodEndsAt,
        },
    });

    await logFinancialAction({
        actorId: subscription.userId,
        actionType: 'subscription.payment_failed',
        referenceId: String(subscription._id),
        previousState: {},
        newState: {
            status: subscription.status,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        },
        metadata,
    });

    return subscription;
};

const enforceSubscriptionExpiry = async () => {
    const now = new Date();
    const expiring = await Subscription.find({
        $or: [
            { status: 'active', expiryDate: { $lt: now } },
            { status: 'grace', gracePeriodEndsAt: { $lt: now } },
        ],
    });

    const updates = expiring.map(async (subscription) => {
        subscription.status = 'expired';
        subscription.cancelledAt = now;
        await subscription.save();

        await User.findByIdAndUpdate(subscription.userId, {
            $set: {
                'subscription.plan': 'free',
                'subscription.billingPeriod': 'none',
                'subscription.nextBillingDate': null,
                'subscription.stripeSubscriptionId': null,
            },
        });

        await logFinancialAction({
            actorId: subscription.userId,
            actionType: 'subscription.expired',
            referenceId: String(subscription._id),
            previousState: {},
            newState: { status: subscription.status },
            metadata: {},
        });
    });

    await Promise.all(updates);

    return {
        expiredCount: updates.length,
    };
};

const cancelSubscription = async ({ userId, actorId }) => {
    const subscription = await Subscription.findOne({ userId });
    if (!subscription) {
        return null;
    }

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    subscription.gracePeriodEndsAt = null;
    await subscription.save();

    await User.findByIdAndUpdate(userId, {
        $set: {
            'subscription.plan': 'free',
            'subscription.billingPeriod': 'none',
            'subscription.nextBillingDate': null,
            'subscription.stripeSubscriptionId': null,
        },
    });

    await logFinancialAction({
        actorId: actorId || userId,
        actionType: 'subscription.cancelled',
        referenceId: String(subscription._id),
        previousState: {},
        newState: { status: subscription.status, cancelledAt: subscription.cancelledAt },
    });

    return subscription;
};

const getSubscriptionState = async ({ userId }) => {
    await enforceSubscriptionExpiry();
    const subscription = await Subscription.findOne({ userId }).lean();
    return subscription;
};

module.exports = {
    createSubscriptionCheckoutSession,
    activateOrRenewSubscription,
    markSubscriptionPaymentFailed,
    enforceSubscriptionExpiry,
    cancelSubscription,
    getSubscriptionState,
};
