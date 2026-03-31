'use strict';
const mongoose = require('mongoose');

/**
 * Review.js — Feature #96
 * Mutual post-hire review system (worker ↔ employer)
 */
const reviewSchema = new mongoose.Schema({
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    reviewerId: { type: String, required: true },
    revieweeId: { type: String, required: true, index: true },
    reviewerRole: { type: String, enum: ['worker', 'employer'], required: true },
    direction: { type: String, enum: ['worker_to_employer', 'employer_to_worker'], required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, maxlength: 1000, default: '' },
    isPublic: { type: Boolean, default: true },
}, { timestamps: true });

reviewSchema.index({ applicationId: 1, direction: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
