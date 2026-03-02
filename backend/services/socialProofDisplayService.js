'use strict';

/**
 * socialProofDisplayService.js
 * 
 * Aggregates existing stats from models and feeds them into the socialProofService
 * to generate the visual Social Proof Layer (Phase 24).
 * 
 * Returns UI-ready badges for job seekers and employers.
 */

const { getWorkerProofLabels, getEmployerProofLabels } = require('./socialProofService');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Job = require('../models/Job');

async function getWorkerSocialProof(workerUserId) {
    const profile = await WorkerProfile.findOne({ user: workerUserId }).select('lastActiveAt').lean();

    // Aggregate Hires (applications where status is hired)
    const hiredCount = await Application.countDocuments({
        worker: profile?._id,
        status: 'hired'
    });

    // Aggregate Interviews
    const interviewCount = await Application.countDocuments({
        worker: profile?._id,
        status: { $in: ['interview_scheduled', 'interview_completed', 'offer_sent', 'offer_accepted', 'escrow_funded', 'work_started', 'payment_released', 'hired'] }
    });

    // We can pull response time from User model if it exists, tracking avg hours
    const user = await User.findById(workerUserId).select('responseScore').lean();

    // rough conversion of 0-100 score to hours (just for visual representation logic scaling fallback)
    // 100 score = < 1 hour, 50 score = ~12 hours
    const score = Number(user?.responseScore) || 50;
    const avgResponseHours = score >= 90 ? 1 : score >= 70 ? 4 : score >= 50 ? 12 : 24;

    const stats = {
        hireCount: hiredCount,
        interviewCount,
        avgResponseHours,
        lastActiveAt: profile?.lastActiveAt
    };

    const labels = getWorkerProofLabels(stats);

    return {
        badges: labels.map(label => ({
            label,
            icon: label.includes('Hired') ? 'trophy' : label.includes('Interview') ? 'briefcase' : label.includes('responder') ? 'zap' : 'clock',
            color: 'blue'
        })),
        stats // returned for transparency
    };
}

async function getEmployerSocialProof(employerUserId) {
    const user = await User.findById(employerUserId).select('trustScore responseScore lastActiveAt').lean();

    // Aggregate Total Hires across all jobs
    const totalHires = await Application.countDocuments({
        employer: employerUserId,
        status: 'hired'
    });

    // Check if actively hiring (has an open job)
    const activeJobsCount = await Job.countDocuments({
        employerId: employerUserId,
        status: 'active',
        isOpen: true
    });
    const isCurrentlyHiring = activeJobsCount > 0;

    const score = Number(user?.responseScore) || 50;
    const avgResponseHours = score >= 90 ? 0.5 : score >= 70 ? 4 : score >= 50 ? 12 : 24;

    const stats = {
        totalHires,
        avgResponseHours,
        lastActiveAt: user?.lastActiveAt,
        isCurrentlyHiring
    };

    const labels = getEmployerProofLabels(stats);

    return {
        badges: labels.map(label => ({
            label,
            icon: label.includes('Hired') ? 'building' : label.includes('response') ? 'zap' : 'activity',
            color: 'purple'
        })),
        stats
    };
}

module.exports = {
    getWorkerSocialProof,
    getEmployerSocialProof
};
