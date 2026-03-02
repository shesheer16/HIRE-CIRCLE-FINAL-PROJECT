'use strict';

/**
 * calendarVisualizationService.js
 * 
 * Provides a read-only visual timeline layer for:
 * 1. Work Calendar (Worker Profile) - shows a candidate's upcoming interviews, job start dates, and payment dates.
 * 2. Shift Timeline (Employer Job) - shows an employer's schedule across all applicants for a specific job.
 * 
 * Aggregates data from:
 * - Application (status dates, e.g. hiredAt, offerAcceptedAt)
 * - ApplicationTransitionLog (for exact work_started timestamps)
 * - InterviewSchedule (for upcoming interviews)
 * - Escrow (for payment release dates)
 */

const Application = require('../models/Application');
const InterviewSchedule = require('../models/InterviewSchedule');
const Escrow = require('../models/Escrow');
const ApplicationTransitionLog = require('../models/ApplicationTransitionLog');

async function buildTimelineFromApplications(applications, role = 'worker') {
    const timeline = [];
    const appIds = applications.map(a => a._id);
    const jobIds = [...new Set(applications.map(a => String(a.job?._id || a.job)))];

    // Fetch related entities
    const interviews = await InterviewSchedule.find({
        applicationId: { $in: appIds },
        status: { $in: ['scheduled', 'completed'] }
    }).populate('jobId', 'title companyName').lean();

    const escrows = await Escrow.find({
        jobId: { $in: jobIds },
        status: { $in: ['funded', 'released'] } // Filter properly later
    }).lean();

    const transitionLogs = await ApplicationTransitionLog.find({
        applicationId: { $in: appIds },
        nextStatus: { $in: ['work_started', 'payment_released'] }
    }).lean();

    // Compile events
    for (const app of applications) {
        const jobId = String(app.job?._id || app.job);
        const jobTitle = app.job?.title || 'Unknown Job';
        const companyName = app.job?.companyName || 'Unknown Company';
        const candidateName = app.worker?.user?.name || 'Candidate'; // Assume populated or partial

        // 1. Interviews
        const appInterviews = interviews.filter(i => String(i.applicationId) === String(app._id));
        for (const interview of appInterviews) {
            timeline.push({
                type: 'interview',
                title: `Interview for ${interview.jobId?.title || jobTitle}`,
                subtitle: role === 'employer' ? `With candidate` : `At ${interview.jobId?.companyName || companyName}`,
                date: interview.scheduledTimeUTC,
                status: interview.status,
                applicationId: app._id,
                jobId: jobId
            });
        }

        // 2. Offer Accepted / Hiring Date
        if (app.offerAcceptedAt || app.hiredAt) {
            const acceptedDate = app.offerAcceptedAt || app.hiredAt;
            timeline.push({
                type: 'job_accepted',
                title: `Job Accepted: ${jobTitle}`,
                subtitle: role === 'employer' ? `Candidate accepted offer` : `You accepted the offer`,
                date: acceptedDate,
                status: 'completed',
                applicationId: app._id,
                jobId: jobId
            });
        }

        // 3. Work Start Date
        const workStartedLog = transitionLogs.find(log => String(log.applicationId) === String(app._id) && log.nextStatus === 'work_started');
        if (workStartedLog) {
            timeline.push({
                type: 'work_started',
                title: `Work Started: ${jobTitle}`,
                subtitle: role === 'employer' ? `Candidate began work` : `You began work`,
                date: workStartedLog.createdAt,
                status: 'completed',
                applicationId: app._id,
                jobId: jobId
            });
        }

        // 4. Payment Release Date
        const appEscrows = escrows.filter(e => String(e.jobId) === jobId && String(e.workerId) === String(app.worker?._id || app.worker));
        for (const escrow of appEscrows) {
            if (escrow.releasedAt) {
                timeline.push({
                    type: 'payment_released',
                    title: `Payment Released: ${jobTitle}`,
                    subtitle: `Amount: ${escrow.amount} ${escrow.currency}`,
                    date: escrow.releasedAt,
                    status: 'completed',
                    applicationId: app._id,
                    jobId: jobId
                });
            } else if (escrow.status === 'funded') {
                // Est. pending payment
                timeline.push({
                    type: 'payment_pending',
                    title: `Escrow Funded: ${jobTitle}`,
                    subtitle: `Amount: ${escrow.amount} ${escrow.currency} pending release`,
                    date: escrow.createdAt,
                    status: 'pending',
                    applicationId: app._id,
                    jobId: jobId
                });
            }
        }
    }

    // Sort chronologically ascending
    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return timeline;
}

/**
 * Gets the "Work Calendar" for a candidate profile.
 */
async function getWorkerCalendar(workerId) {
    // Only active or recently completed apps
    const applications = await Application.find({
        worker: workerId,
        status: { $in: ['shortlisted', 'interview_scheduled', 'offer_sent', 'offer_accepted', 'escrow_funded', 'work_started', 'work_completed', 'payment_released', 'hired'] },
        isArchived: false
    }).populate('job', 'title companyName').lean();

    return buildTimelineFromApplications(applications, 'worker');
}

/**
 * Gets the "Shift Timeline" for an employer's specific job.
 */
async function getJobShiftTimeline(jobId, employerId) {
    const applications = await Application.find({
        job: jobId,
        employer: employerId,
        status: { $in: ['shortlisted', 'interview_scheduled', 'offer_sent', 'offer_accepted', 'escrow_funded', 'work_started', 'work_completed', 'payment_released', 'hired'] },
        isArchived: false
    }).populate('job', 'title companyName').lean();

    return buildTimelineFromApplications(applications, 'employer');
}

module.exports = {
    getWorkerCalendar,
    getJobShiftTimeline,
    buildTimelineFromApplications // exported for testing
};
