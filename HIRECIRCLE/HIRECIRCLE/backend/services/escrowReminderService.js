'use strict';
/**
 * escrowReminderService.js
 * Feature #94 — Escrow Protection Reminders on Pay Events
 *
 * Generates reminders/notifications when escrow events occur.
 * Non-disruptive: reads from existing escrow state. No payment logic changes.
 */

const REMINDER_TEMPLATES = {
    funded: {
        title: '🔐 Escrow Funded',
        body: 'Your payment is secured in escrow. Start work confidently.',
    },
    release_pending: {
        title: '⏳ Payment Release Pending',
        body: 'Work marked complete. Payment will be released after confirmation.',
    },
    released: {
        title: '✅ Payment Released',
        body: 'Your payment has been released to your wallet. Great work!',
    },
    dispute_open: {
        title: '⚠️ Dispute Opened',
        body: 'A dispute has been raised. Our team will review within 48 hours.',
    },
    expiring_soon: {
        title: '⏰ Offer Expiring Soon',
        body: 'Your job offer is expiring. Accept or decline before it expires.',
    },
};

/**
 * Get reminder content for an escrow event.
 */
function getEscrowReminderContent(eventType) {
    return REMINDER_TEMPLATES[eventType] || null;
}

/**
 * Build a notification payload for an escrow event.
 */
function buildEscrowNotification(eventType, { userId, applicationId, amount } = {}) {
    const template = getEscrowReminderContent(eventType);
    if (!template) return null;

    return {
        userId: String(userId || ''),
        title: template.title,
        body: amount != null
            ? `${template.body} Amount: ₹${Number(amount).toLocaleString()}`
            : template.body,
        type: 'escrow_reminder',
        eventType,
        applicationId: applicationId ? String(applicationId) : null,
        data: { applicationId, eventType },
    };
}

module.exports = { getEscrowReminderContent, buildEscrowNotification, REMINDER_TEMPLATES };
