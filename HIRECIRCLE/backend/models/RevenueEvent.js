const mongoose = require('mongoose');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');
const { safeEmitEventEnvelope } = require('../services/eventEnvelopeService');

const revenueEventSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        eventType: {
            type: String,
            enum: ['subscription_charge', 'boost_purchase', 'api_overage_charge'],
            required: true,
            index: true,
        },
        amountInr: {
            type: Number,
            required: true,
        },
        amountBase: {
            type: Number,
            default: null,
        },
        baseCurrency: {
            type: String,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        displayAmount: {
            type: Number,
            default: null,
        },
        displayCurrency: {
            type: String,
            default: null,
            uppercase: true,
        },
        exchangeRateUsed: {
            type: Number,
            default: 1,
        },
        currency: {
            type: String,
            default: 'inr',
        },
        status: {
            type: String,
            enum: ['succeeded', 'failed'],
            default: 'succeeded',
            index: true,
        },
        city: {
            type: String,
            default: 'Hyderabad',
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
        },
        stripeSessionId: {
            type: String,
            default: null,
            index: true,
        },
        stripeSubscriptionId: {
            type: String,
            default: null,
        },
        settledAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

revenueEventSchema.index({ city: 1, settledAt: -1, status: 1 });
revenueEventSchema.index({ stripeSessionId: 1, eventType: 1 }, { unique: true, sparse: true });

revenueEventSchema.pre('validate', function normalizeMonetaryFields(next) {
    const baseAmount = Number(this.amountBase);
    if (!Number.isFinite(baseAmount)) {
        this.amountBase = Number(this.amountInr || 0);
    }

    if (this.displayAmount === null || this.displayAmount === undefined) {
        this.displayAmount = Number(this.amountBase || this.amountInr || 0);
    }

    const normalizedBaseCurrency = String(this.baseCurrency || DEFAULT_BASE_CURRENCY).trim().toUpperCase() || DEFAULT_BASE_CURRENCY;
    this.baseCurrency = normalizedBaseCurrency;
    this.displayCurrency = String(this.displayCurrency || this.currency || normalizedBaseCurrency).trim().toUpperCase() || normalizedBaseCurrency;
    this.currency = String(this.currency || this.displayCurrency || normalizedBaseCurrency).trim().toLowerCase();

    const exchangeRate = Number(this.exchangeRateUsed);
    this.exchangeRateUsed = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;

    if (!Number.isFinite(Number(this.amountInr))) {
        this.amountInr = Number(this.amountBase || 0);
    }

    next();
});

revenueEventSchema.post('save', (doc) => {
    safeEmitEventEnvelope({
        eventId: `revenue-${String(doc._id)}`,
        eventType: `REVENUE_${String(doc.eventType || 'event').toUpperCase()}`,
        actorId: doc.employerId ? String(doc.employerId) : null,
        entityId: doc.jobId ? String(doc.jobId) : (doc._id ? String(doc._id) : null),
        metadata: {
            status: doc.status,
            amountBase: Number(doc.amountBase || doc.amountInr || 0),
            baseCurrency: doc.baseCurrency,
            city: doc.city,
            ...((doc.metadata && typeof doc.metadata === 'object') ? doc.metadata : {}),
        },
        timestampUTC: doc.settledAt || doc.createdAt || new Date(),
        region: doc.city || null,
        source: 'RevenueEvent',
    });
});

module.exports = mongoose.model('RevenueEvent', revenueEventSchema);
