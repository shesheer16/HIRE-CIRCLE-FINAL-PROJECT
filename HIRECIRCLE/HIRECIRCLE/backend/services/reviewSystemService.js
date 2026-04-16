'use strict';
/**
 * reviewSystemService.js
 * Feature #96 — Review System for Employers + Seekers
 *
 * Post-hire mutual review system:
 *  - Worker reviews Employer (1-5 stars + text) after job completion
 *  - Employer reviews Worker after job completion
 *  - Reviews visible on profiles (aggregated)
 *  - No review before hired/completed state
 *  - Single review per application (one each direction)
 *
 * Non-disruptive: additive layer. Uses existing Application model.
 */

const Review = require('../models/Review');
const Application = require('../models/Application');

const ELIGIBLE_STATUSES = ['hired', 'work_completed', 'payment_released'];

/**
 * Submit a review for a completed engagement.
 */
async function submitReview({ reviewerId, reviewerRole, applicationId, rating, comment }) {
    if (!reviewerId || !applicationId) {
        throw Object.assign(new Error('reviewerId and applicationId required'), { code: 400 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw Object.assign(new Error('Rating must be integer 1-5'), { code: 400 });
    }

    const app = await Application.findById(applicationId)
        .select('status employer worker')
        .lean();
    if (!app) throw Object.assign(new Error('Application not found'), { code: 404 });

    if (!ELIGIBLE_STATUSES.includes(app.status)) {
        throw Object.assign(new Error('Reviews only allowed after job completion'), { code: 400 });
    }

    // Determine reviewee
    const employerId = String(app.employer || '');
    const workerId = String(app.worker || '');
    const rid = String(reviewerId);

    let revieweeId, direction;
    if (rid === employerId) {
        revieweeId = workerId;
        direction = 'employer_to_worker';
    } else if (rid === workerId) {
        revieweeId = employerId;
        direction = 'worker_to_employer';
    } else {
        throw Object.assign(new Error('Not a participant in this application'), { code: 403 });
    }

    // One review per direction per application
    const existing = await Review.exists({ applicationId, direction });
    if (existing) throw Object.assign(new Error('Review already submitted'), { code: 409 });

    const review = await Review.create({
        applicationId,
        reviewerId: rid,
        revieweeId,
        reviewerRole,
        direction,
        rating,
        comment: String(comment || '').trim().slice(0, 1000),
    });

    return { reviewId: String(review._id), submitted: true };
}

/**
 * Get aggregate review stats for a user.
 */
async function getReviewStats(userId) {
    const reviews = await Review.find({ revieweeId: String(userId) })
        .select('rating')
        .lean();

    if (reviews.length === 0) return { averageRating: null, totalReviews: 0 };

    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return {
        averageRating: Math.round((sum / reviews.length) * 10) / 10,
        totalReviews: reviews.length,
    };
}

/**
 * Get all reviews for a user (public-safe).
 */
async function getReviewsForUser(userId, { limit = 10, skip = 0 } = {}) {
    return Review.find({ revieweeId: String(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(limit, 50))
        .select('rating comment direction createdAt reviewerId')
        .lean();
}

module.exports = { submitReview, getReviewStats, getReviewsForUser };
