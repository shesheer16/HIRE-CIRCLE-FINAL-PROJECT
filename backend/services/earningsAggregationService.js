'use strict';

/**
 * earningsAggregationService.js
 * 
 * Provides a read-only visual aggregation layer for the Earnings Dashboard.
 * 
 * Aggregates data from:
 * - Escrow (pending vs released totals, completed job count, avg payout time)
 * - FinancialTransaction (withdrawn total, monthly earnings chart)
 */

const Escrow = require('../models/Escrow');
const FinancialTransaction = require('../models/FinancialTransaction');

/**
 * Get aggregated earnings data for a worker's Wallet Dashboard.
 * @param {String} workerId
 */
async function getEarningsDashboard(workerId) {
    // 1. Escrows
    const escrows = await Escrow.find({ workerId }).lean();

    let pendingEscrowTotal = 0;
    let releasedEscrowTotal = 0;
    const completedJobIds = new Set();
    let totalPayoutTimeMs = 0;
    let payoutCount = 0;

    for (const escrow of escrows) {
        if (escrow.status === 'funded') {
            pendingEscrowTotal += escrow.amount;
        } else if (escrow.status === 'released') {
            releasedEscrowTotal += escrow.amount;
            completedJobIds.add(String(escrow.jobId));

            if (escrow.createdAt && escrow.releasedAt) {
                totalPayoutTimeMs += (new Date(escrow.releasedAt) - new Date(escrow.createdAt));
                payoutCount++;
            }
        }
    }

    const completedJobsCount = completedJobIds.size;

    // Average payout time in hours
    let averagePayoutTimeHours = 0;
    if (payoutCount > 0) {
        averagePayoutTimeHours = totalPayoutTimeMs / payoutCount / (1000 * 60 * 60);
    }

    // 2. Withdrawals
    const withdrawals = await FinancialTransaction.find({
        userId: workerId,
        type: 'debit',
        source: 'withdrawal_processed',
        status: 'completed'
    }).lean();

    const withdrawnTotal = withdrawals.reduce((sum, w) => sum + w.amount, 0);

    // 3. Monthly Earnings Chart (Last 6 months based on escrow_release transactions)
    // We'll use FinancialTransaction for accurate ledger credits
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 5);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const earningTransactions = await FinancialTransaction.find({
        userId: workerId,
        type: 'credit',
        source: 'escrow_release',
        status: 'completed',
        createdAt: { $gte: startDate }
    }).lean();

    // Init chart with 0s
    const monthlyChart = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthYear = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        monthlyChart.push({ label: monthYear, amount: 0, monthIndex: d.getMonth(), year: d.getFullYear() });
    }

    for (const txn of earningTransactions) {
        const txnDate = new Date(txn.createdAt);
        const monthKey = txnDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        const chartNode = monthlyChart.find(n => n.label === monthKey);
        if (chartNode) {
            chartNode.amount += txn.amount;
        }
    }

    return {
        pendingEscrowTotal,
        releasedEscrowTotal,
        withdrawnTotal,
        completedJobsCount,
        averagePayoutTimeHours: Number(averagePayoutTimeHours.toFixed(1)),
        monthlyEarningsChart: monthlyChart
    };
}

module.exports = {
    getEarningsDashboard,
};
