const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        topic: {
            type: String,
            enum: ['account', 'payment', 'job_dispute', 'bug_report', 'other'],
            required: true
        },
        subject: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'resolved', 'closed'],
            default: 'open',
            index: true
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'low'
        },
        metadata: {
            jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
            applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' }
        },
        deflectedByFaq: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
