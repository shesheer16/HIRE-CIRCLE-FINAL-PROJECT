'use strict';
/**
 * CompanyFollow.js
 * Feature #37 — Follow Company
 *
 * Tracks which users follow which employers (company pages).
 * Used for:
 *  - Push notifications when employer posts new jobs
 *  - Follow count display on employer profile
 *  - Personalised job feed boosting followed-company jobs
 */
const mongoose = require('mongoose');

const companyFollowSchema = new mongoose.Schema(
    {
        followerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        employerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        companyName: { type: String, trim: true, maxlength: 200 },
        notificationsEnabled: { type: Boolean, default: true },
    },
    { timestamps: true }
);

companyFollowSchema.index({ followerId: 1, employerUserId: 1 }, { unique: true });

module.exports = mongoose.model('CompanyFollow', companyFollowSchema);
