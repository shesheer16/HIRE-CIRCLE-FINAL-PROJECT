'use strict';
const mongoose = require('mongoose');
/**
 * SwipeDecision.js — Features #4, #27, #55
 * Stores user swipe decisions on job cards for personalization.
 */
const swipeSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    jobId: { type: String, required: true },
    action: { type: String, enum: ['interested', 'not_interested', 'apply', 'skip'], required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});
swipeSchema.index({ userId: 1, jobId: 1 }, { unique: true });
module.exports = mongoose.model('SwipeDecision', swipeSchema);
