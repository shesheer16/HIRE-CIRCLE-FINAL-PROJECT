'use strict';
/**
 * SavedJobCollection.js
 * Feature #7 — Saved Job Collections (folders)
 *
 * Allows job seekers to organise saved jobs into named collections.
 * e.g. "Dream Jobs", "Backup Options", "Applied"
 */
const mongoose = require('mongoose');

const savedJobCollectionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        description: { type: String, trim: true, maxlength: 300, default: '' },
        jobs: [
            {
                jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
                savedAt: { type: Date, default: Date.now },
                note: { type: String, maxlength: 500, default: '' },
            },
        ],
        isDefault: { type: Boolean, default: false },   // user's "Saved Jobs" default folder
        emoji: { type: String, maxlength: 4, default: '📌' },
        jobCount: { type: Number, default: 0 },
    },
    {
        timestamps: true,
        // max 20 collections per user (enforced at service layer)
    }
);

// Keep jobCount in sync automatically
savedJobCollectionSchema.pre('save', function (next) {
    this.jobCount = Array.isArray(this.jobs) ? this.jobs.length : 0;
    next();
});

savedJobCollectionSchema.index({ userId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('SavedJobCollection', savedJobCollectionSchema);
