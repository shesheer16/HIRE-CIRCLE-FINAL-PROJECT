'use strict';
/**
 * careerCoachingService.js
 * Feature #66 — Career Coaching / Event Ads
 *
 * Manages coaching packages, event advertisements, and slot bookings.
 * Non-disruptive: additive layer.
 */

const COACHING_PACKAGES = {
    resume_review: { name: 'Resume Review', price: 499, durationMinutes: 30 },
    mock_interview: { name: 'Mock Interview', price: 999, durationMinutes: 60 },
    career_strategy: { name: 'Career Strategy Session', price: 1999, durationMinutes: 90 },
    full_package: { name: 'Full Career Package', price: 4999, durationMinutes: 300 },
};

const EVENT_TYPES = ['webinar', 'workshop', 'networking', 'job_fair', 'masterclass'];

/**
 * Get all available coaching packages.
 */
function getCoachingPackages() {
    return Object.entries(COACHING_PACKAGES).map(([key, val]) => ({ key, ...val }));
}

/**
 * Build a coaching booking record.
 */
function buildCoachingBooking(userId, packageKey, scheduledAt) {
    const pkg = COACHING_PACKAGES[packageKey];
    if (!pkg) {
        throw Object.assign(new Error(`Invalid package key. Allowed: ${Object.keys(COACHING_PACKAGES).join(', ')}`), { code: 400 });
    }
    if (!userId) throw Object.assign(new Error('userId is required'), { code: 400 });
    return {
        userId: String(userId),
        packageKey,
        packageName: pkg.name,
        price: pkg.price,
        durationMinutes: pkg.durationMinutes,
        scheduledAt: scheduledAt || null,
        bookedAt: new Date(),
        status: 'pending',
    };
}

/**
 * Build an event ad record.
 */
function buildEventAd(title, eventType, organizerId, price) {
    if (!EVENT_TYPES.includes(eventType)) {
        throw Object.assign(new Error(`Invalid event type. Allowed: ${EVENT_TYPES.join(', ')}`), { code: 400 });
    }
    if (!title || !organizerId) {
        throw Object.assign(new Error('title and organizerId are required'), { code: 400 });
    }
    return {
        title: String(title).trim(),
        eventType,
        organizerId: String(organizerId),
        price: Number(price) || 0,
        createdAt: new Date(),
        active: true,
    };
}

/**
 * Calculate discounted price for a package.
 */
function applyDiscount(packageKey, discountPercent) {
    const pkg = COACHING_PACKAGES[packageKey];
    if (!pkg) return null;
    const discount = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    return Math.round(pkg.price * (1 - discount / 100));
}

module.exports = {
    COACHING_PACKAGES,
    EVENT_TYPES,
    getCoachingPackages,
    buildCoachingBooking,
    buildEventAd,
    applyDiscount,
};
