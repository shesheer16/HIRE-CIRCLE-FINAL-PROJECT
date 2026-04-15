const FraudFlag = require('../../models/FraudFlag');
const PaymentRecord = require('../../models/PaymentRecord');
const PaymentMethodFingerprint = require('../../models/PaymentMethodFingerprint');
const Escrow = require('../../models/Escrow');

const FAILURE_THRESHOLD = Number.parseInt(process.env.FRAUD_PAYMENT_FAILURE_THRESHOLD || '3', 10);
const REFUND_THRESHOLD = Number.parseInt(process.env.FRAUD_RAPID_REFUND_THRESHOLD || '2', 10);
const ESCROW_ABUSE_MIN_CASES = Number.parseInt(process.env.FRAUD_ESCROW_ABUSE_MIN_CASES || '5', 10);
const ESCROW_ABUSE_RATIO = Number(process.env.FRAUD_ESCROW_ABUSE_RATIO || 0.4);

const createFraudFlag = async ({ userId, flagType, reason, score, relatedUsers = [], evidence = {} }) => {
    const now = new Date();
    const recentWindow = new Date(now.getTime() - (12 * 60 * 60 * 1000));

    const existing = await FraudFlag.findOne({
        userId,
        flagType,
        reason,
        createdAt: { $gte: recentWindow },
    });

    if (existing) return existing;

    return FraudFlag.create({
        userId,
        flagType,
        reason,
        score,
        relatedUsers,
        evidence,
    });
};

const trackPaymentMethodFingerprint = async ({ userId, paymentRecordId, fingerprint }) => {
    if (!fingerprint || !userId || !paymentRecordId) return null;

    try {
        await PaymentMethodFingerprint.create({
            fingerprint,
            userId,
            paymentRecordId,
        });
    } catch (error) {
        if (!String(error?.message || '').includes('duplicate key')) throw error;
    }

    const owners = await PaymentMethodFingerprint.distinct('userId', { fingerprint });
    if (owners.length > 1) {
        const flagPromises = owners.map((ownerId) => createFraudFlag({
            userId: ownerId,
            flagType: 'multi_account',
            reason: 'Shared payment method fingerprint detected',
            score: 85,
            relatedUsers: owners.filter((entry) => String(entry) !== String(ownerId)),
            evidence: {
                fingerprint,
                ownerCount: owners.length,
            },
        }));

        await Promise.all(flagPromises);
    }

    return owners;
};

const detectPaymentFailurePattern = async ({ userId }) => {
    const since = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const failures = await PaymentRecord.countDocuments({
        userId,
        status: 'failed',
        updatedAt: { $gte: since },
    });

    if (failures >= FAILURE_THRESHOLD) {
        return createFraudFlag({
            userId,
            flagType: 'payment_failures',
            reason: 'Repeated payment failures in short window',
            score: 65,
            evidence: { failures, threshold: FAILURE_THRESHOLD },
        });
    }

    return null;
};

const detectRapidRefundPattern = async ({ userId }) => {
    const since = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const refunds = await PaymentRecord.countDocuments({
        userId,
        status: 'refunded',
        updatedAt: { $gte: since },
    });

    if (refunds >= REFUND_THRESHOLD) {
        return createFraudFlag({
            userId,
            flagType: 'rapid_refund',
            reason: 'Rapid refund pattern detected',
            score: 75,
            evidence: { refunds, threshold: REFUND_THRESHOLD },
        });
    }

    return null;
};

const detectEscrowAbusePattern = async ({ userId }) => {
    const since = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

    const [totalEscrows, riskyEscrows] = await Promise.all([
        Escrow.countDocuments({ employerId: userId, createdAt: { $gte: since } }),
        Escrow.countDocuments({
            employerId: userId,
            createdAt: { $gte: since },
            status: { $in: ['refunded', 'disputed'] },
        }),
    ]);

    if (totalEscrows < ESCROW_ABUSE_MIN_CASES) return null;

    const ratio = riskyEscrows / Math.max(totalEscrows, 1);
    if (ratio >= ESCROW_ABUSE_RATIO) {
        return createFraudFlag({
            userId,
            flagType: 'escrow_abuse',
            reason: 'Escrow abuse pattern detected',
            score: 80,
            evidence: {
                totalEscrows,
                riskyEscrows,
                ratio,
                minCases: ESCROW_ABUSE_MIN_CASES,
                thresholdRatio: ESCROW_ABUSE_RATIO,
            },
        });
    }

    return null;
};

const listFraudFlags = async ({ status = null, limit = 100 }) => {
    const query = {};
    if (status) query.status = status;

    return FraudFlag.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
        .lean();
};

module.exports = {
    trackPaymentMethodFingerprint,
    detectPaymentFailurePattern,
    detectRapidRefundPattern,
    detectEscrowAbusePattern,
    listFraudFlags,
};
