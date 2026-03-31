const InterviewSchedule = require('../models/InterviewSchedule');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { transitionApplicationStatus } = require('../services/applicationWorkflowService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { isRecruiter } = require('../utils/roleGuards');

const parseDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const queueLifecycleAutomation = async ({ scheduleId, reason }) => enqueueBackgroundJob({
    type: 'lifecycle_automation',
    payload: {
        interviewScheduleId: String(scheduleId),
        reason: reason || 'interview_schedule_update',
    },
});

const createInterviewSchedule = async (req, res) => {
    try {
        const { applicationId, scheduledTimeUTC, timezone } = req.body || {};
        if (!applicationId || !scheduledTimeUTC || !String(timezone || '').trim()) {
            return res.status(400).json({ message: 'applicationId, scheduledTimeUTC and timezone are required' });
        }

        const scheduleTime = parseDate(scheduledTimeUTC);
        if (!scheduleTime || scheduleTime <= new Date()) {
            return res.status(400).json({ message: 'scheduledTimeUTC must be a valid future timestamp' });
        }

        const application = await Application.findById(applicationId).select('_id employer worker job status');
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }
        if (String(application.employer) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the employer can schedule interviews' });
        }

        const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
        const interviewSchedule = await InterviewSchedule.create({
            applicationId: application._id,
            jobId: application.job,
            employerId: application.employer,
            candidateId: application.worker,
            scheduledTimeUTC: scheduleTime,
            timezone: String(timezone).trim(),
            status: 'scheduled',
        });

        await transitionApplicationStatus({
            applicationDoc: application,
            nextStatus: 'interview_requested',
            actorType: 'employer',
            actorId: req.user._id,
            reason: 'interview_scheduled',
            metadata: {
                interviewScheduleId: String(interviewSchedule._id),
            },
        });

        await Promise.all([
            queueNotificationDispatch({
                userId: application.employer,
                type: 'interview_schedule',
                title: 'Interview scheduled',
                message: 'Interview has been scheduled successfully.',
                relatedData: {
                    applicationId: String(application._id),
                    interviewScheduleId: String(interviewSchedule._id),
                },
                pushCategory: 'application_status',
            }),
            workerProfile?.user ? queueNotificationDispatch({
                userId: workerProfile.user,
                type: 'interview_schedule',
                title: 'Interview requested',
                message: `Interview scheduled for ${scheduleTime.toISOString()}.`,
                relatedData: {
                    applicationId: String(application._id),
                    interviewScheduleId: String(interviewSchedule._id),
                },
                pushCategory: 'application_status',
            }) : Promise.resolve(),
        ]);

        await queueLifecycleAutomation({
            scheduleId: interviewSchedule._id,
            reason: 'interview_scheduled',
        });

        return res.status(201).json({
            success: true,
            data: interviewSchedule,
        });
    } catch (error) {
        if (error?.code === 'INVALID_STATUS_TRANSITION') {
            return res.status(409).json({ message: error.message, details: error.details || null });
        }
        return res.status(500).json({ message: 'Failed to schedule interview' });
    }
};

const completeInterviewSchedule = async (req, res) => {
    try {
        const schedule = await InterviewSchedule.findById(req.params.id);
        if (!schedule) {
            return res.status(404).json({ message: 'Interview schedule not found' });
        }
        if (String(schedule.employerId) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the employer can mark interview complete' });
        }
        if (schedule.status !== 'scheduled') {
            return res.status(409).json({ message: `Interview is already ${schedule.status}` });
        }

        schedule.status = 'completed';
        schedule.completedAt = new Date();
        await schedule.save();

        const application = await Application.findById(schedule.applicationId);
        if (application) {
            await transitionApplicationStatus({
                applicationDoc: application,
                nextStatus: 'interview_completed',
                actorType: 'employer',
                actorId: req.user._id,
                reason: 'interview_completed',
                metadata: {
                    interviewScheduleId: String(schedule._id),
                },
            });

            const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
            await Promise.all([
                queueNotificationDispatch({
                    userId: application.employer,
                    type: 'interview_schedule',
                    title: 'Interview marked complete',
                    message: 'Interview completion has been recorded.',
                    relatedData: {
                        applicationId: String(application._id),
                        interviewScheduleId: String(schedule._id),
                    },
                    pushCategory: 'application_status',
                }),
                workerProfile?.user ? queueNotificationDispatch({
                    userId: workerProfile.user,
                    type: 'interview_schedule',
                    title: 'Interview completed',
                    message: 'Your interview has been marked complete.',
                    relatedData: {
                        applicationId: String(application._id),
                        interviewScheduleId: String(schedule._id),
                    },
                    pushCategory: 'application_status',
                }) : Promise.resolve(),
            ]);
        }

        await queueLifecycleAutomation({
            scheduleId: schedule._id,
            reason: 'interview_completed',
        });

        return res.json({
            success: true,
            data: schedule,
        });
    } catch (error) {
        if (error?.code === 'INVALID_STATUS_TRANSITION') {
            return res.status(409).json({ message: error.message, details: error.details || null });
        }
        return res.status(500).json({ message: 'Failed to mark interview complete' });
    }
};

const rescheduleInterview = async (req, res) => {
    try {
        const { scheduledTimeUTC, timezone } = req.body || {};
        const nextTime = parseDate(scheduledTimeUTC);
        if (!nextTime || nextTime <= new Date()) {
            return res.status(400).json({ message: 'scheduledTimeUTC must be a valid future timestamp' });
        }

        const schedule = await InterviewSchedule.findById(req.params.id);
        if (!schedule) {
            return res.status(404).json({ message: 'Interview schedule not found' });
        }

        const application = await Application.findById(schedule.applicationId).select('_id employer worker');
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }
        if (String(application.employer) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the employer can reschedule interviews' });
        }
        if (schedule.status !== 'scheduled') {
            return res.status(409).json({ message: `Cannot reschedule interview in status ${schedule.status}` });
        }

        schedule.scheduledTimeUTC = nextTime;
        schedule.timezone = String(timezone || schedule.timezone || 'UTC').trim();
        schedule.reminder24hSentAt = null;
        schedule.reminder1hSentAt = null;
        await schedule.save();

        const workerProfile = await WorkerProfile.findById(application.worker).select('_id user');
        await Promise.all([
            queueNotificationDispatch({
                userId: application.employer,
                type: 'interview_schedule',
                title: 'Interview rescheduled',
                message: 'Interview schedule was updated.',
                relatedData: {
                    applicationId: String(application._id),
                    interviewScheduleId: String(schedule._id),
                },
                pushCategory: 'application_status',
            }),
            workerProfile?.user ? queueNotificationDispatch({
                userId: workerProfile.user,
                type: 'interview_schedule',
                title: 'Interview rescheduled',
                message: `Interview has been moved to ${nextTime.toISOString()}.`,
                relatedData: {
                    applicationId: String(application._id),
                    interviewScheduleId: String(schedule._id),
                },
                pushCategory: 'application_status',
            }) : Promise.resolve(),
        ]);

        await queueLifecycleAutomation({
            scheduleId: schedule._id,
            reason: 'interview_rescheduled',
        });

        return res.json({
            success: true,
            data: schedule,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to reschedule interview' });
    }
};

const listInterviewSchedules = async (req, res) => {
    try {
        const query = {};
        if (isRecruiter(req.user)) {
            query.employerId = req.user._id;
        } else {
            const workerProfile = await WorkerProfile.findOne({ user: req.user._id }).select('_id');
            if (!workerProfile) {
                return res.json({ success: true, count: 0, data: [] });
            }
            query.candidateId = workerProfile._id;
        }

        if (req.query.status) {
            query.status = String(req.query.status).toLowerCase();
        }
        if (req.query.applicationId) {
            query.applicationId = req.query.applicationId;
        }

        const schedules = await InterviewSchedule.find(query)
            .sort({ scheduledTimeUTC: 1 })
            .limit(500)
            .lean();

        return res.json({
            success: true,
            count: schedules.length,
            data: schedules,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch interview schedules' });
    }
};

module.exports = {
    createInterviewSchedule,
    completeInterviewSchedule,
    rescheduleInterview,
    listInterviewSchedules,
};
