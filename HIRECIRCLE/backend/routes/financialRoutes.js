const express = require('express');
const router = express.Router();

const { protect, admin } = require('../middleware/authMiddleware');
const {
    createSubscriptionCheckout,
    getMySubscription,
    cancelMySubscription,
    fundEscrowController,
    releaseEscrowController,
    refundEscrowController,
    getEscrowDetail,
    getMyWallet,
    getMyTransactions,
    settlePendingWallet,
    updateWalletKycController,
    requestWithdrawalController,
    listMyWithdrawals,
    listAllWithdrawals,
    approveWithdrawalController,
    rejectWithdrawalController,
    raiseDisputeController,
    resolveDisputeController,
    listDisputesController,
    listFraudFlagsController,
    listAuditLogsController,
    getCommissionConfigController,
    upsertCommissionConfigController,
} = require('../controllers/financialController');

router.get('/wallet', protect, getMyWallet);
router.get('/wallet/transactions', protect, getMyTransactions);
router.post('/wallet/:userId/settle', protect, admin, settlePendingWallet);
router.post('/wallet/:userId/kyc', protect, admin, updateWalletKycController);

router.post('/escrow/fund', protect, fundEscrowController);
router.post('/escrow/:escrowId/release', protect, releaseEscrowController);
router.post('/escrow/:escrowId/refund', protect, refundEscrowController);
router.get('/escrow/:escrowId', protect, getEscrowDetail);

router.post('/withdrawals/request', protect, requestWithdrawalController);
router.get('/withdrawals', protect, listMyWithdrawals);
router.get('/admin/withdrawals', protect, admin, listAllWithdrawals);
router.post('/admin/withdrawals/:withdrawalId/approve', protect, admin, approveWithdrawalController);
router.post('/admin/withdrawals/:withdrawalId/reject', protect, admin, rejectWithdrawalController);

router.post('/disputes', protect, raiseDisputeController);
router.get('/admin/disputes', protect, admin, listDisputesController);
router.post('/admin/disputes/:disputeId/resolve', protect, admin, resolveDisputeController);

router.post('/subscriptions/checkout', protect, createSubscriptionCheckout);
router.get('/subscriptions/me', protect, getMySubscription);
router.post('/subscriptions/cancel', protect, cancelMySubscription);

router.get('/admin/fraud-flags', protect, admin, listFraudFlagsController);
router.get('/admin/audit-logs', protect, admin, listAuditLogsController);
router.get('/admin/commission-config', protect, admin, getCommissionConfigController);
router.post('/admin/commission-config', protect, admin, upsertCommissionConfigController);

module.exports = router;
