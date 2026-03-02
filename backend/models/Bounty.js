const mongoose = require('mongoose');

const bountySubmissionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    message: {
        type: String,
        default: '',
        trim: true,
    },
    attachmentUrl: {
        type: String,
        default: '',
        trim: true,
    },
    submittedAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });

const bountySchema = new mongoose.Schema({
    creatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },
    reward: {
        type: Number,
        required: true,
        min: 0,
    },
    deadline: {
        type: Date,
        required: true,
        index: true,
    },
    submissions: {
        type: [bountySubmissionSchema],
        default: [],
    },
    winnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true,
    },
    status: {
        type: String,
        enum: ['open', 'reviewing', 'completed', 'expired'],
        default: 'open',
        index: true,
    },
}, {
    timestamps: true,
});

bountySchema.pre('save', function preSaveBounty(next) {
    const now = Date.now();
    const deadlineEpoch = new Date(this.deadline).getTime();
    if (
        Number.isFinite(deadlineEpoch)
        && deadlineEpoch < now
        && ['open', 'reviewing'].includes(String(this.status || '').toLowerCase())
    ) {
        this.status = 'expired';
    }
    if (typeof next === 'function') {
        return next();
    }
    return undefined;
});

bountySchema.index({ status: 1, createdAt: -1 });
bountySchema.index({ creatorId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Bounty', bountySchema);
