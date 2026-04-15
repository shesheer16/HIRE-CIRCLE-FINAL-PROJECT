import client from '../api/client';

export const getWallet = async () => {
    const { data } = await client.get('/api/financial/wallet');
    return data.wallet;
};

export const getTransactions = async ({ limit = 100, offset = 0 } = {}) => {
    const { data } = await client.get('/api/financial/wallet/transactions', {
        params: { limit, offset },
    });
    if (!Array.isArray(data?.transactions)) {
        throw new Error('Invalid transactions payload.');
    }
    return data.transactions;
};

export const fundEscrow = async ({ jobId, workerId, amount, currency = 'INR', paymentRecordId }) => {
    const { data } = await client.post('/api/financial/escrow/fund', {
        jobId,
        workerId,
        amount,
        currency,
        paymentRecordId,
    });
    return data;
};

export const getEscrowDetail = async (escrowId) => {
    const { data } = await client.get(`/api/financial/escrow/${escrowId}`);
    return data.escrow;
};

export const releaseEscrow = async (escrowId) => {
    const { data } = await client.post(`/api/financial/escrow/${escrowId}/release`, {});
    return data;
};

export const refundEscrow = async (escrowId, reason) => {
    const { data } = await client.post(`/api/financial/escrow/${escrowId}/refund`, { reason });
    return data;
};

export const requestWithdrawal = async ({ amount, currency = 'INR' }) => {
    const { data } = await client.post('/api/financial/withdrawals/request', {
        amount,
        currency,
    });
    return data.withdrawal;
};

export const getMyWithdrawals = async () => {
    const { data } = await client.get('/api/financial/withdrawals');
    if (!Array.isArray(data?.withdrawals)) {
        throw new Error('Invalid withdrawals payload.');
    }
    return data.withdrawals;
};

export const raiseDispute = async ({ escrowId, reason }) => {
    const { data } = await client.post('/api/financial/disputes', {
        escrowId,
        reason,
    });
    return data;
};
