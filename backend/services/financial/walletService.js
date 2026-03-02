const { getWalletSnapshot, getTransactions, movePendingToAvailable } = require('./ledgerService');
const Wallet = require('../../models/Wallet');

const getWallet = async ({ userId }) => getWalletSnapshot({ userId });

const getWalletTransactions = async ({ userId, limit, offset }) => getTransactions({ userId, limit, offset });

const settlePendingBalance = async ({ userId, amount, actorId }) => movePendingToAvailable({
    userId,
    amount,
    referenceId: `manual_settlement:${String(userId)}`,
    metadata: {
        actorId: String(actorId || ''),
        source: 'admin_settlement',
    },
});

const updateWalletKycStatus = async ({ userId, kycStatus }) => {
    const normalized = String(kycStatus || '').trim().toLowerCase();
    if (!['not_started', 'pending', 'verified', 'rejected'].includes(normalized)) {
        throw new Error('Invalid KYC status');
    }

    return Wallet.findOneAndUpdate(
        { userId },
        {
            $set: {
                kycStatus: normalized,
                updatedAt: new Date(),
            },
        },
        {
            returnDocument: 'after',
            upsert: true,
        }
    );
};

module.exports = {
    getWallet,
    getWalletTransactions,
    settlePendingBalance,
    updateWalletKycStatus,
};
