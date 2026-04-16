'use strict';
/**
 * SavedSearch.js
 * Feature #17 — Saved Searches + Alert Triggers
 *
 * Stores a user's search query + filters for re-use and push-alert triggers.
 */
const mongoose = require('mongoose');

const savedSearchSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        name: { type: String, trim: true, maxlength: 80, required: true },
        filters: {
            keyword: { type: String, maxlength: 200, default: '' },
            location: { type: String, maxlength: 200, default: '' },
            radiusKm: { type: Number, min: 1, max: 500, default: 25 },
            minSalary: { type: Number, default: null },
            maxSalary: { type: Number, default: null },
            jobType: { type: String, enum: ['full_time', 'part_time', 'gig', 'contract', 'any'], default: 'any' },
            skills: [{ type: String, maxlength: 60 }],
        },
        alertEnabled: { type: Boolean, default: true },
        alertFrequency: {
            type: String,
            enum: ['realtime', 'daily', 'weekly'],
            default: 'daily',
        },
        lastAlertSentAt: { type: Date, default: null },
        hitCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

savedSearchSchema.index({ userId: 1, alertEnabled: 1 });

module.exports = mongoose.model('SavedSearch', savedSearchSchema);
