'use strict';
const mongoose = require('mongoose');

/**
 * Assessment.js — Features #8, #68
 * Skill assessment certificates issued after test completion.
 */
const assessmentSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    jobId: { type: String, default: null },
    skill: { type: String, required: true, maxlength: 100 },
    score: { type: Number, required: true },
    passMark: { type: Number, default: 70 },
    passed: { type: Boolean, required: true, index: true },
    issuedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Assessment', assessmentSchema);
