'use strict';

/**
 * notificationEnhancementService.js
 * 
 * Provides an additive layer for enhanced push notifications to drive conversion (Phase 26).
 * Hooks into the existing Notification model and event system.
 */

const Notification = require('../models/Notification');

async function triggerEnhancedNotification(userId, type, payload) {
    if (!userId) return;

    let title = '';
    let message = '';
    const relatedData = { ...payload };

    switch (type) {
        case 'new_high_match':
            title = 'New High-Match Job!';
            message = `A new job "${payload.jobTitle}" matches your profile by ${payload.matchPercent}%. Apply now.`;
            relatedData.type = 'job_match'; // Map to existing enum
            break;

        case 'interview_reminder_2h':
            title = 'Upcoming Interview Reminder';
            message = `Your interview with ${payload.companyName} is starting in 2 hours. Be ready!`;
            relatedData.type = 'interview_schedule';
            break;

        case 'employer_viewed_profile':
            title = 'An Employer Viewed Your Profile';
            message = `${payload.companyName} just viewed your profile. Make sure your details are up to date!`;
            relatedData.type = 'employer_viewed_profile';
            break;

        case 'offer_expiring_soon':
            title = 'Offer Expiring Soon';
            message = `Your offer for "${payload.jobTitle}" expires in less than 24 hours. Accept it before it's gone!`;
            relatedData.type = 'offer_update';
            break;

        case 'escrow_funded_alert':
            title = 'Payment Secured in Escrow';
            message = `${payload.companyName} has funded ${payload.amount} ${payload.currency} into Escrow. You are safe to start work.`;
            relatedData.type = 'escrow_update';
            break;

        default:
            return;
    }

    // Deduplication check: prevent spamming the exact same notification in a short window (e.g., 24h)
    if (payload.dedupeKey) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existing = await Notification.findOne({
            user: userId,
            'relatedData.dedupeKey': payload.dedupeKey,
            createdAt: { $gte: twentyFourHoursAgo }
        }).lean();

        if (existing) {
            return; // Skip duplicate
        }
        relatedData.dedupeKey = payload.dedupeKey;
    }

    const notification = new Notification({
        user: userId,
        type: relatedData.type,
        title,
        message,
        relatedData
    });

    await notification.save();
    return notification;
}

module.exports = {
    triggerEnhancedNotification
};
