const mongoose = require('mongoose');

const applicationSchema = mongoose.Schema(
    {
        job: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Job',
        },
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'WorkerProfile',
        },
        employer: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User', // Employer User ID
        },
        initiatedBy: {
            type: String,
            required: true,
            enum: ['worker', 'employer'], // who sent the request?
        },
        status: {
            type: String,
            required: true,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending',
        },
        lastMessage: {
            type: String,
            default: '', // Preview text for the chat list
        },
    },
    {
        timestamps: true,
    }
);

// Prevent duplicate applications for the same job by the same worker
applicationSchema.index({ job: 1, worker: 1 }, { unique: true });

const Application = mongoose.model('Application', applicationSchema);

module.exports = Application;
