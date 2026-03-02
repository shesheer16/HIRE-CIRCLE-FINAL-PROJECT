const mongoose = require('mongoose');

const matchFeedbackSchema = mongoose.Schema(
    {
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
        },
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkerProfile',
            required: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        matchScoreAtTime: {
            type: Number,
            required: true,
        },
        userAction: {
            type: String,
            enum: ['shortlisted', 'interviewed', 'hired', 'rejected'],
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

matchFeedbackSchema.index({ jobId: 1, createdAt: -1 });

const MatchFeedback = mongoose.model('MatchFeedback', matchFeedbackSchema);
module.exports = MatchFeedback;
