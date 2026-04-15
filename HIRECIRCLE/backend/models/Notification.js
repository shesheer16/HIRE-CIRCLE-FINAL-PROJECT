const mongoose = require('mongoose');

const notificationSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        type: {
            type: String,
            enum: [
                'match_found',
                'application_received',
                'application_accepted',
                'message_received',
                'job_match',
                'bounty_update',
                'community_invite',
                'community_reply',
                'employer_viewed_profile',
                'reengagement_nudge',
                'status_update',
                'interview_ready',
                'abuse_alert',
                'lifecycle_automation',
                'workflow_reminder',
                'offer_update',
                'interview_schedule',
                'escrow_update',
            ],
            required: true
        },
        title: {
            type: String,
            required: true
        },
        message: {
            type: String,
            required: true
        },
        relatedData: {
            jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
            candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerProfile' },
            applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
            interviewScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewSchedule' },
            offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
            escrowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escrow' },
            chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
            processingId: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewProcessingJob' },
            nudgeType: { type: String },
            reminderType: { type: String },
            dedupeKey: { type: String },
            exportRequestId: { type: mongoose.Schema.Types.ObjectId },
            downloadUrl: { type: String },
            nextAction: { type: String },
            metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        },
        isRead: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

// Index to quickly fetch unread notifications for a user
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ user: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
