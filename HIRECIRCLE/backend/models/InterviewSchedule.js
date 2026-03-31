const mongoose = require('mongoose');

const interviewScheduleSchema = new mongoose.Schema(
    {
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
            index: true,
        },
        scheduledTimeUTC: {
            type: Date,
            required: true,
            index: true,
        },
        timezone: {
            type: String,
            required: true,
            default: 'UTC',
        },
        status: {
            type: String,
            enum: ['scheduled', 'completed', 'missed', 'cancelled'],
            default: 'scheduled',
            index: true,
        },
        reminder24hSentAt: {
            type: Date,
            default: null,
        },
        reminder1hSentAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        missedAt: {
            type: Date,
            default: null,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'interview_schedules',
    }
);

interviewScheduleSchema.index({ applicationId: 1, status: 1, scheduledTimeUTC: 1 });
interviewScheduleSchema.index({ employerId: 1, status: 1, scheduledTimeUTC: 1 });
interviewScheduleSchema.index({ candidateId: 1, status: 1, scheduledTimeUTC: 1 });

module.exports = mongoose.model('InterviewSchedule', interviewScheduleSchema);

