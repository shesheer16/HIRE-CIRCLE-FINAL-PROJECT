'use strict';

/**
 * earningsAggregationIntegrity.test.js
 * 
 * Tests the Earnings Dashboard Layer.
 * Verifies that:
 * 1. Earnings chart is built correctly over 6 months from FinancialTransactions.
 * 2. Pending and released escrow totals are accurate without duplicate job counting.
 * 3. Withdrawn total correctly filters debit transactions.
 * 4. Average payout time is correctly calculated from Escrow dates.
 */

const { getEarningsDashboard } = require('../services/earningsAggregationService');
const Escrow = require('../models/Escrow');
const FinancialTransaction = require('../models/FinancialTransaction');

jest.mock('../models/Escrow');
jest.mock('../models/FinancialTransaction');

describe('Earnings Dashboard Aggregation Integrity', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Aggregates earnings metrics accurately', async () => {
        const workerId = 'worker_abc';

        // Mock Escrows
        Escrow.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([
                {
                    workerId,
                    jobId: 'job_1',
                    amount: 1000,
                    status: 'released',
                    createdAt: new Date('2026-03-01T10:00:00Z'),
                    releasedAt: new Date('2026-03-02T10:00:00Z') // 24 hours payout
                },
                {
                    workerId,
                    jobId: 'job_2',
                    amount: 500,
                    status: 'released',
                    createdAt: new Date('2026-03-05T10:00:00Z'),
                    releasedAt: new Date('2026-03-07T10:00:00Z') // 48 hours payout
                },
                {
                    workerId,
                    jobId: 'job_3',
                    amount: 2000,
                    status: 'funded', // Pending
                    createdAt: new Date('2026-03-10T10:00:00Z')
                }
            ])
        });

        const currentMonth = new Date().getMonth();
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;

        const currentMonthDate = new Date();
        const prevMonthDate = new Date();
        prevMonthDate.setMonth(prevMonth);

        // Mock Financial Transactions
        FinancialTransaction.find.mockImplementation((query) => {
            if (query.source === 'withdrawal_processed') {
                return {
                    lean: jest.fn().mockResolvedValue([
                        { amount: 500, type: 'debit', status: 'completed' },
                        { amount: 200, type: 'debit', status: 'completed' }
                    ])
                };
            }
            if (query.source === 'escrow_release') {
                return {
                    lean: jest.fn().mockResolvedValue([
                        { amount: 1000, type: 'credit', status: 'completed', createdAt: currentMonthDate },
                        { amount: 500, type: 'credit', status: 'completed', createdAt: prevMonthDate }
                    ])
                };
            }
            return { lean: jest.fn().mockResolvedValue([]) };
        });

        const dashboard = await getEarningsDashboard(workerId);

        // 1. Pending Escrow (Job 3: 2000)
        expect(dashboard.pendingEscrowTotal).toBe(2000);

        // 2. Released Escrow (Job 1: 1000 + Job 2: 500 = 1500)
        expect(dashboard.releasedEscrowTotal).toBe(1500);

        // 3. Completed Jobs (Job 1 & 2 = 2)
        expect(dashboard.completedJobsCount).toBe(2);

        // 4. Avg Payout Time (24h + 48h = 72h / 2 = 36 hours)
        expect(dashboard.averagePayoutTimeHours).toBe(36);

        // 5. Withdrawn Total (500 + 200 = 700)
        expect(dashboard.withdrawnTotal).toBe(700);

        // 6. Monthly Chart
        expect(dashboard.monthlyEarningsChart).toHaveLength(6);
        const currentMonthNode = dashboard.monthlyEarningsChart.find(n => n.monthIndex === currentMonth);
        const prevMonthNode = dashboard.monthlyEarningsChart.find(n => n.monthIndex === prevMonth);

        expect(currentMonthNode.amount).toBe(1000);
        expect(prevMonthNode.amount).toBe(500);
    });

});
