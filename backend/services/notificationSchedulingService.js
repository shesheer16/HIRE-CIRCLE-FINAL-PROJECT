'use strict';
/**
 * notificationSchedulingService.js
 * Feature #34: In-app reminders (jobs closing soon)
 * Feature #35: Scheduled notification queue (apply reunlocks)
 * Feature #39: Auto job expiry reminder
 * Feature #40: Application milestone notifications
 * Feature #41: Interview scheduled calendar link
 * 
 * Non-disruptive: pure logic layer for evaluating when to trigger notifications 
 * based on job/application state changes.
 */

const NOTIFICATION_TYPES = {
    JOB_CLOSING_SOON: 'JOB_CLOSING_SOON',
    APPLY_REUNLOCKED: 'APPLY_REUNLOCKED',
    JOB_EXPIRED: 'JOB_EXPIRED',
    MILESTONE_REACHED: 'MILESTONE_REACHED',
    INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED'
};

/**
 * Check if a job is closing soon (within 48 hours). #34
 */
function isJobClosingSoon(jobExpiryDate) {
    if (!jobExpiryDate) return false;
    const now = new Date();
    const expiry = new Date(jobExpiryDate);
    const msLeft = expiry - now;
    return msLeft > 0 && msLeft <= 48 * 60 * 60 * 1000; // <= 48 hours
}

/**
 * Feature #35: Scheduled notification queue logic
 * For jobs a user swiped "save for later", check if they should be reminded.
 */
function shouldSendReunlockReminder(savedJobDate, hasApplied) {
    if (hasApplied) return false;
    const now = new Date();
    const saved = new Date(savedJobDate);
    const msSinceSave = now - saved;
    // Remind after 3 days if not applied
    return msSinceSave > 3 * 24 * 60 * 60 * 1000 && msSinceSave < 4 * 24 * 60 * 60 * 1000;
}

/**
 * Feature #40: Application milestone notifications
 */
function buildMilestoneNotification(applicationStatus) {
    const milestones = {
        'reviewed': 'The employer has reviewed your application!',
        'shortlisted': 'Great news! You have been shortlisted.',
        'interview': 'You have been invited to an interview.',
        'hired': 'Congratulations! You got the job!'
    };
    return milestones[applicationStatus] || null;
}

/**
 * Feature #41: Interview scheduled calendar link
 */
function generateCalendarLink(interviewDetails) {
    const { title, startStr, endStr, description, location } = interviewDetails;
    // Basic formatting for a generic ICS text output (frontend can generate real .ics or URI)
    return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:${title}
DTSTART:${startStr}
DTEND:${endStr}
DESCRIPTION:${description}
LOCATION:${location}
END:VEVENT
END:VCALENDAR`;
}

module.exports = {
    NOTIFICATION_TYPES,
    isJobClosingSoon,
    shouldSendReunlockReminder,
    buildMilestoneNotification,
    generateCalendarLink
};
