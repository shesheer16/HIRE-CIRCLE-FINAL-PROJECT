const ApiBillingUsage = require('../models/ApiBillingUsage');
const RevenueEvent = require('../models/RevenueEvent');

const INCLUDED_MONTHLY_CALLS = {
    free: Number.parseInt(process.env.API_INCLUDED_CALLS_FREE || '10000', 10),
    partner: Number.parseInt(process.env.API_INCLUDED_CALLS_PARTNER || '200000', 10),
    enterprise: Number.parseInt(process.env.API_INCLUDED_CALLS_ENTERPRISE || '2000000', 10),
};

const OVERAGE_BLOCK_SIZE = Number.parseInt(process.env.API_OVERAGE_BLOCK_SIZE || '1000', 10);
const OVERAGE_BLOCK_COST_INR = Number.parseInt(process.env.API_OVERAGE_BLOCK_COST_INR || '500', 10);

const toMonthBucket = (date = new Date()) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const resolveIncludedCalls = (planType = 'free') => {
    const normalized = String(planType || 'free').trim().toLowerCase();
    return INCLUDED_MONTHLY_CALLS[normalized] || INCLUDED_MONTHLY_CALLS.free;
};

const enforceTierPolicy = ({ planType = 'free', overageCalls = 0 }) => {
    const normalizedPlan = String(planType || 'free').trim().toLowerCase();
    if (normalizedPlan === 'free' && Number(overageCalls) > 0) {
        return {
            blocked: true,
            status: 402,
            message: 'Free API tier exceeded monthly quota. Upgrade required.',
        };
    }

    return {
        blocked: false,
        status: 200,
        message: null,
    };
};

const maybeRecordOverageCharge = async ({ apiKey, usage }) => {
    if (!apiKey?.ownerId) return;
    if (!usage || usage.overageCalls <= 0) return;

    const currentBlock = Math.floor(usage.overageCalls / OVERAGE_BLOCK_SIZE);
    if (currentBlock <= Number(usage.lastOverageChargedBlock || 0)) {
        return;
    }

    const newBlocks = currentBlock - Number(usage.lastOverageChargedBlock || 0);
    const amountInr = newBlocks * OVERAGE_BLOCK_COST_INR;

    await RevenueEvent.create({
        employerId: apiKey.ownerId,
        eventType: 'api_overage_charge',
        amountInr,
        status: 'succeeded',
        metadata: {
            apiKeyId: String(apiKey._id),
            apiKeyKeyId: apiKey.keyId || null,
            newBlocks,
            currentBlock,
            overageCalls: usage.overageCalls,
        },
    });

    usage.lastOverageChargedBlock = currentBlock;
    await usage.save();
};

const trackApiUsageForBilling = async ({ apiKey, statusCode = 200, burstViolation = false } = {}) => {
    if (!apiKey?._id) {
        return null;
    }

    const planType = String(apiKey.planType || apiKey.tier || 'free').toLowerCase();
    const monthBucket = toMonthBucket(new Date());
    const includedCalls = resolveIncludedCalls(planType);
    const isSuccess = Number(statusCode) >= 200 && Number(statusCode) < 400;

    const usage = await ApiBillingUsage.findOneAndUpdate(
        {
            apiKeyId: apiKey._id,
            monthBucket,
        },
        {
            $setOnInsert: {
                ownerId: apiKey.ownerId || apiKey.employerId || null,
                organization: apiKey.organization || null,
                planType,
                includedCalls,
            },
            $set: {
                planType,
                includedCalls,
                lastCallAt: new Date(),
            },
            $inc: {
                totalCalls: 1,
                successfulCalls: isSuccess ? 1 : 0,
                failedCalls: isSuccess ? 0 : 1,
                burstViolations: burstViolation ? 1 : 0,
            },
        },
        {
            new: true,
            upsert: true,
        }
    );

    usage.overageCalls = Math.max(0, Number(usage.totalCalls || 0) - Number(usage.includedCalls || 0));
    await usage.save();

    await maybeRecordOverageCharge({ apiKey, usage });

    return {
        usage,
        policy: enforceTierPolicy({
            planType,
            overageCalls: usage.overageCalls,
        }),
    };
};

module.exports = {
    INCLUDED_MONTHLY_CALLS,
    OVERAGE_BLOCK_SIZE,
    OVERAGE_BLOCK_COST_INR,
    toMonthBucket,
    resolveIncludedCalls,
    enforceTierPolicy,
    trackApiUsageForBilling,
};
