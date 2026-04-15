const CommissionConfig = require('../../models/CommissionConfig');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getDefaultCommission = (planType = 'free') => {
    const envPercent = Number(process.env.DEFAULT_COMMISSION_PERCENTAGE || 10);
    const envFlatFee = Number(process.env.DEFAULT_COMMISSION_FLAT_FEE || 0);

    if (planType === 'pro') {
        return {
            percentage: Number(process.env.PRO_COMMISSION_PERCENTAGE || Math.max(envPercent - 2, 0)),
            flatFee: Number(process.env.PRO_COMMISSION_FLAT_FEE || envFlatFee),
        };
    }

    if (planType === 'enterprise') {
        return {
            percentage: Number(process.env.ENTERPRISE_COMMISSION_PERCENTAGE || Math.max(envPercent - 5, 0)),
            flatFee: Number(process.env.ENTERPRISE_COMMISSION_FLAT_FEE || envFlatFee),
        };
    }

    return {
        percentage: envPercent,
        flatFee: envFlatFee,
    };
};

const resolveCommissionRate = (config, planType = 'free') => {
    const fallback = getDefaultCommission(planType);
    if (!config) return fallback;

    const planConfig = config.planTypeBased?.[planType];
    if (planConfig && Number.isFinite(Number(planConfig.percentage))) {
        return {
            percentage: Number(planConfig.percentage),
            flatFee: Number(planConfig.flatFee || 0),
        };
    }

    return {
        percentage: Number(config.percentage || fallback.percentage),
        flatFee: Number(config.flatFee || fallback.flatFee),
    };
};

const getActiveCommissionConfig = async () => CommissionConfig.findOne({
    isActive: true,
    effectiveFrom: { $lte: new Date() },
}).sort({ effectiveFrom: -1 });

const calculateCommission = async ({ grossAmount, planType = 'free' }) => {
    const normalizedGross = Number(grossAmount);
    if (!Number.isFinite(normalizedGross) || normalizedGross <= 0) {
        throw new Error('Invalid gross amount for commission calculation');
    }

    const config = await getActiveCommissionConfig();
    const resolved = resolveCommissionRate(config, planType);

    const percentage = clamp(Number(resolved.percentage || 0), 0, 100);
    const flatFee = Math.max(0, Number(resolved.flatFee || 0));

    const commissionAmount = Math.min(
        normalizedGross,
        Math.round(((normalizedGross * (percentage / 100)) + flatFee) * 100) / 100
    );

    const netAmount = Math.max(0, Math.round((normalizedGross - commissionAmount) * 100) / 100);

    return {
        configId: config?._id ? String(config._id) : null,
        percentage,
        flatFee,
        grossAmount: normalizedGross,
        commissionAmount,
        netAmount,
    };
};

module.exports = {
    getActiveCommissionConfig,
    calculateCommission,
};
