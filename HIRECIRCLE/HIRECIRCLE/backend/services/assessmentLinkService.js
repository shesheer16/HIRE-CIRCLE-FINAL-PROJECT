'use strict';
/**
 * assessmentLinkService.js
 * Feature #8 — Job Test/Assessment Link (Employer-Provided)
 * Feature #68 — In-App Skill Test Certificates
 *
 * Manages assessment links on job postings + certificate records.
 * Non-disruptive: additive fields. No job creation flow changes.
 */

const Job = require('../models/Job');
const Assessment = require('../models/Assessment');

/**
 * Attach an assessment link to a job.
 */
async function attachAssessmentLink(jobId, employerId, { url, title, durationMinutes } = {}) {
    if (!url || !url.startsWith('http')) throw Object.assign(new Error('Valid assessment URL required'), { code: 400 });
    const job = await Job.findOne({ _id: jobId, employer: employerId });
    if (!job) throw Object.assign(new Error('Job not found or not yours'), { code: 404 });

    job.assessment = { url, title: String(title || 'Skill Assessment').slice(0, 100), durationMinutes: durationMinutes || null };
    await job.save();
    return { jobId: String(job._id), assessment: job.assessment };
}

/**
 * Issue a skill certificate after assessment completion.
 * Feature #68
 */
async function issueCertificate({ userId, jobId, skill, score, passMark = 70 }) {
    const passed = Number(score || 0) >= Number(passMark);
    const cert = await Assessment.create({
        userId: String(userId),
        jobId: jobId ? String(jobId) : null,
        skill: String(skill || '').slice(0, 100),
        score: Number(score),
        passMark: Number(passMark),
        passed,
        issuedAt: new Date(),
    });
    return { certificateId: String(cert._id), passed, skill, score };
}

/**
 * Get all certificates for a user.
 */
async function getUserCertificates(userId) {
    return Assessment.find({ userId: String(userId), passed: true })
        .sort({ issuedAt: -1 })
        .select('skill score passMark issuedAt jobId')
        .lean();
}

module.exports = { attachAssessmentLink, issueCertificate, getUserCertificates };
